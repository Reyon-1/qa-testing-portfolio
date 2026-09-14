/**
 * 概览异常状态与控制台：
 * - page.route：在浏览器发出请求前拦截接口
 * - route.fulfill：模拟 500 错误
 * - route.fetch：读取真实响应后再清空数组型数据，保留真实接口协议
 * - pageerror/console：监听前端运行时错误和浏览器 error 日志
 */
import { expect } from '@playwright/test';
import { test } from './概览fixtures';
import { OverviewPage } from './概览测试辅助';
import { userStatePath } from '../登录状态';

test.describe('概览异常状态与控制台', () => {
  test.use({ storageState: userStatePath });

  // 递归把所有数组型业务数据清空，保留对象外壳，避免猜测后端响应协议
  function emptyCollections(value: unknown): { value: unknown; changed: boolean } {
    if (Array.isArray(value)) return { value: [], changed: true };
    if (!value || typeof value !== 'object') return { value, changed: false };

    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const emptied = emptyCollections(item);
      result[key] = emptied.value;
      changed ||= emptied.changed;
    }
    return { value: result, changed };
  }

  test('接口失败时显示错误提示', async ({ authedPage: page }) => {
    // 先正常打开概览，避免故障注入误伤登录后的菜单初始化接口
    const overview = new OverviewPage(page);
    await overview.open();
    await overview.waitForData();

    // page.route：只拦截后续第一个 XHR/fetch API 请求，模拟图表接口 500
    let apiRequests = 0;
    let faultInjected = false;
    await page.route('**/api/**', async (route) => {
      if (!faultInjected && ['xhr', 'fetch'].includes(route.request().resourceType())) {
        faultInjected = true;
        apiRequests += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'mock failure' }),
        });
        return;
      }
      await route.continue();
    });

    // waitForResponse 与 click 组成因果链：500 必须是本次点击触发的
    const failedResponse = page.waitForResponse(
      (response) => response.status() === 500,
      { timeout: 10000 }
    );
    await page.getByText('30天', { exact: true }).first().click();
    await failedResponse;

    expect(apiRequests, '接口失败场景没有命中刷新 API，故障注入规则可能失效').toBe(1);

    // 优先定位 alert/错误状态容器，再断言其中存在可读错误文案
    const errorState = page.locator('[role="alert"], [class*="error"], [class*="Error"], [class*="错误"]');
    await expect(errorState.first(), '接口返回500后没有渲染错误提示组件').toBeVisible();
    await expect(
      errorState.first(),
      '错误提示组件没有显示可读的错误文案'
    ).toContainText(/加载失败|请求失败|错误|失败|Request failed with status code 500/);
  });

  test('接口返回空数据时显示空状态', async ({ authedPage: page }) => {
    // addInitScript：在页面初始化前包装 Canvas fillText；Canvas 空状态文字会打上测试标记
    await page.addInitScript(() => {
      const canvasPrototype = globalThis.CanvasRenderingContext2D?.prototype;
      if (!canvasPrototype) return;

      const originalFillText = canvasPrototype.fillText;
      canvasPrototype.fillText = function (text, x, y, maxWidth) {
        if (/暂无数据|暂无记录|数据为空|暂无/.test(String(text))) {
          this.canvas.setAttribute('data-ui-automation-empty-state', 'true');
        }
        return maxWidth === undefined
          ? originalFillText.call(this, text, x, y)
          : originalFillText.call(this, text, x, y, maxWidth);
      };
    });

    const overview = new OverviewPage(page);
    await overview.open();
    await overview.waitForData();

    // route.fetch 读取真实响应后，把数组型业务数据清空，再返回给页面
    let apiRequests = 0;
    let emptiedResponses = 0;
    await page.route('**/api/**', async (route) => {
      if (!['xhr', 'fetch'].includes(route.request().resourceType())) {
        await route.continue();
        return;
      }

      apiRequests += 1;
      const response = await route.fetch();
      const contentType = response.headers()['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        await route.fulfill({ response });
        return;
      }

      try {
        const original = await response.json();
        const emptied = emptyCollections(original);
        if (emptied.changed) {
          emptiedResponses += 1;
          await route.fulfill({ response, body: JSON.stringify(emptied.value) });
        } else {
          await route.fulfill({ response });
        }
      } catch {
        // 非 JSON 响应保持原样，避免异常测试改变无关接口协议
        await route.fulfill({ response });
      }
    });

    const emptyResponse = page.waitForResponse(
      (response) => response.status() === 200 && response.url().includes('/api/'),
      { timeout: 10000 }
    );
    await page.getByText('30天', { exact: true }).first().click();
    await emptyResponse;

    // expect.poll：持续轮询测试侧变量，等待故障注入确实发生
    await expect.poll(() => apiRequests, { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => emptiedResponses, { timeout: 10000 }).toBeGreaterThan(0);

    // 空状态必须属于平台调用趋势卡片，不能把其他模块的暂无文本混入判断
    const targetCard = overview.getCard('平台调用趋势');
    await expect(targetCard, '平台调用趋势卡片在空数据场景下消失').toBeVisible();

    const emptyText = targetCard.getByText(/暂无数据|暂无记录|数据为空|暂无/, { exact: false }).first();
    const emptySemantic = targetCard.locator('[role="status"], [role="alert"], [aria-label*="暂无"], [aria-label*="空数据"], [title*="暂无"], [title*="空数据"]').first();
    const emptyVisual = targetCard.locator('[class*="empty"], [class*="Empty"], [class*="暂无"], [data-testid*="empty"], img[alt*="暂无"], img[alt*="数据"], svg[aria-label*="暂无"], svg[aria-label*="数据"]').first();
    const canvasEmptyState = targetCard.locator('canvas[data-ui-automation-empty-state="true"]').first();
    const unlabeledImage = targetCard.locator('img').first();

    // 空状态可能是 DOM 文本、语义组件、图片或 Canvas，必须支持多种真实实现
    const hasTextState = await emptyText.isVisible().catch(() => false);
    const hasSemanticState = await emptySemantic.isVisible().catch(() => false);
    const hasVisualState = await emptyVisual.isVisible().catch(() => false);
    const hasCanvasEmptyState = await canvasEmptyState.isVisible().catch(() => false);
    const hasUnlabeledImage = await unlabeledImage.isVisible().catch(() => false);

    expect(
      hasTextState || hasSemanticState || hasVisualState || hasCanvasEmptyState || hasUnlabeledImage,
      '平台调用趋势接口返回空集合后没有渲染可见空状态，疑似产品缺陷'
    ).toBe(true);

    if (hasTextState) {
      await expect(emptyText, '平台调用趋势空状态文字不明确')
        .toContainText(/暂无数据|暂无记录|数据为空|暂无/);
    }
  });

  test('页面没有未捕获的Console错误', async ({ authedPage: page }) => {
    const errors: string[] = [];

    // pageerror：前端运行时未捕获异常；console：浏览器 error 日志
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    const overview = new OverviewPage(page);
    await overview.open();

    expect(errors, `概览页面出现未捕获前端错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
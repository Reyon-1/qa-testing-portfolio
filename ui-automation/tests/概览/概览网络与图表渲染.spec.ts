/**
 * 概览网络与图表渲染：
 * - response 事件：监听真实接口响应状态
 * - boundingBox：读取元素真实渲染尺寸
 * - Canvas getImageData：检查 Canvas 是否有非透明像素
 * - SVG shape 节点：检查 SVG 是否真正绘制图形
 * - elementFromPoint：检查卡片中心是否被其他元素遮挡
 */
import { expect } from '@playwright/test';
import { test } from './概览fixtures';
import { OverviewPage } from './概览测试辅助';
import { userStatePath } from '../登录状态';

test.describe('概览网络与图表渲染', () => {
  test.use({ storageState: userStatePath });

  test('概览接口没有返回5xx错误', async ({ authedPage: page }) => {
    const serverErrors: string[] = [];

    // response 事件：只读监听接口响应，不修改后端数据
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    const overview = new OverviewPage(page);
    await overview.open();

    expect(serverErrors, `概览接口返回5xx：\n${serverErrors.join('\n')}`).toEqual([]);
  });

  test('每个概览图表模块都有可见渲染区域', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    // 逐个图表模块检查标题、完整卡片和真实布局尺寸
    for (const title of [
      '平台调用趋势',
      '平台收入趋势',
      '模型调用/消耗分布',
      '租户运营排行TOP5',
      '问题分布图',
      '调用时段热力分布',
      '近24小时调用分布',
    ]) {
      const heading = page.getByText(title, { exact: true }).first();
      await expect(heading, `图表标题不可见：${title}`).toBeVisible();

      const card = overview.getCard(title);
      await expect(card, `图表标题所在的完整卡片不存在：${title}`).toBeVisible();

      // boundingBox：读取卡片真实布局坐标和尺寸
      const box = await card.boundingBox();
      expect(box, `${title} 的图表卡片没有渲染尺寸`).not.toBeNull();
      expect(box!.width, `${title} 宽度异常`).toBeGreaterThan(120);
      expect(box!.height, `${title} 高度异常`).toBeGreaterThan(80);
    }
  });

  test('每个概览图表都有实际绘制内容', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    for (const title of [
      '平台调用趋势',
      '平台收入趋势',
      '模型调用/消耗分布',
      '问题分布图',
      '调用时段热力分布',
      '近24小时调用分布',
    ]) {
      const card = overview.getCard(title);
      const canvas = card.locator('canvas').first();
      const svg = card.locator('svg').first();
      const canvasCount = await card.locator('canvas').count();
      const svgCount = await card.locator('svg').count();

      expect(canvasCount + svgCount, `${title} 未找到 Canvas 或 SVG 绘图节点`).toBeGreaterThan(0);

      if (canvasCount > 0) {
        // Canvas 通过 getImageData 检查像素，过滤纯透明/纯空白画布
        const hasPixels = await canvas.evaluate((element) => {
          const node = element as HTMLCanvasElement;
          if (node.width === 0 || node.height === 0) return false;
          const context = node.getContext('2d');
          if (!context) return false;
          const pixels = context.getImageData(0, 0, node.width, node.height).data;
          for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] > 0) return true;
          }
          return false;
        });
        expect(hasPixels, `${title} Canvas 存在但没有实际绘制像素`).toBe(true);
      } else {
        // SVG 通过 path/rect/circle 等图形节点判断真实绘制
        await expect(svg, `${title} SVG 绘图节点不可见`).toBeVisible();
        const shapeCount = await svg.locator('path,rect,circle,line,polyline,polygon').count();
        expect(shapeCount, `${title} SVG 存在但没有实际图形元素`).toBeGreaterThan(0);
      }
    }
  });

  test('可见操作按钮都有可访问名称', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    // getByRole('button')：按无障碍语义定位按钮
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    expect(count, '概览页至少应有一个可操作按钮').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible())) continue;

      // 按钮必须有 aria-label、title 或可见文本，否则无键盘用户无法理解用途
      const accessibleName = await button.getAttribute('aria-label')
        ?? await button.getAttribute('title')
        ?? (await button.textContent())?.trim();
      expect(accessibleName, `第${index + 1}个可见按钮缺少可访问名称`).toBeTruthy();
    }
  });

  test('关键图表卡片没有被遮挡且位于视口内', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    for (const title of ['平台调用趋势', '平台收入趋势', '模型调用/消耗分布']) {
      const card = overview.getCard(title);

      // scrollIntoViewIfNeeded：把卡片滚动到可检查区域
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();

      const viewportHeight = page.viewportSize()?.height ?? 720;

      // 在浏览器内执行 elementFromPoint，确认卡片中心命中的元素属于当前卡片
      const visible = await card.evaluate((element, point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return Boolean(hit && (hit === element || element.contains(hit)));
      }, {
        x: box!.x + box!.width / 2,
        y: Math.min(box!.y + box!.height / 2, viewportHeight - 1),
      });

      expect(visible, `${title} 卡片中心点不可见或被遮挡`).toBe(true);
    }
  });
});
/**
 * 概览时间范围筛选：
 * - Playwright click：模拟用户点击 7天/30天
 * - evaluate：在浏览器中读取 DOM 选中状态
 * - request 事件 + waitForRequest：证明筛选操作真的触发了新接口请求
 * - requestSignature：把请求 URL、方法、参数组成签名，避免把旧请求误判成新请求
 */
import { expect } from '@playwright/test';
import { test } from './概览fixtures';
import { OverviewPage, recordApiRequests, requestSignature } from './概览测试辅助';
import { userStatePath } from '../登录状态';

test.describe('概览时间范围筛选', () => {
  test.use({ storageState: userStatePath });

  test('点击7天和30天后按钮变为选中状态', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    for (const text of ['7天', '30天']) {
      // 页面可能因框架渲染重复文本节点，这里取第一个候选按钮
      const button = page.getByText(text, { exact: true }).first();

      // 点击前读取文字节点及祖先的状态，兼容 aria、data、CSS class 三类选中实现
      const beforeState = await button.evaluate((element) => {
        const states: string[] = [];
        let node: Element | null = element;
        for (let level = 0; node && level < 5; level += 1, node = node.parentElement) {
          states.push([
            node.tagName,
            node.getAttribute('class') ?? '',
            node.getAttribute('aria-pressed') ?? '',
            node.getAttribute('aria-selected') ?? '',
            node.getAttribute('aria-checked') ?? '',
            node.getAttribute('data-state') ?? '',
            node.getAttribute('data-active') ?? '',
            node.getAttribute('data-selected') ?? '',
          ].join('|'));
        }
        return states;
      });

      // click：模拟用户点击时间范围按钮
      await button.click();

      // 点击后再读取一次状态，判断选中状态确实发生变化
      const afterState = await button.evaluate((element) => {
        const states: string[] = [];
        let node: Element | null = element;
        for (let level = 0; node && level < 5; level += 1, node = node.parentElement) {
          states.push([
            node.tagName,
            node.getAttribute('class') ?? '',
            node.getAttribute('aria-pressed') ?? '',
            node.getAttribute('aria-selected') ?? '',
            node.getAttribute('aria-checked') ?? '',
            node.getAttribute('data-state') ?? '',
            node.getAttribute('data-active') ?? '',
            node.getAttribute('data-selected') ?? '',
          ].join('|'));
        }
        return states;
      });

      expect(
        JSON.stringify(afterState) !== JSON.stringify(beforeState),
        `时间范围“${text}”点击后 DOM 选中状态没有变化`
      ).toBe(true);
    }
  });

  test('切换30天后触发图表数据重新请求', async ({ authedPage: page }) => {
    // request 事件先注册监听，避免漏掉后续点击触发的请求
    const requests = recordApiRequests(page);
    const overview = new OverviewPage(page);
    await overview.open();

    // 记录点击前的请求签名
    const before = requests.map(requestSignature);

    // waitForRequest 必须在 click 前注册，保证捕获的是本次操作触发的请求
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/'),
      { timeout: 10000 }
    );

    // click：模拟用户点击 30天
    await page.getByText('30天', { exact: true }).first().click();

    // 等待本次操作对应的接口请求出现
    const request = await requestPromise;
    const signature = requestSignature({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
    });

    // 新请求签名不能出现在点击前，证明确实是本次筛选触发的
    expect(before, '点击30天前页面已经存在相同请求签名').not.toContain(signature);
  });
});
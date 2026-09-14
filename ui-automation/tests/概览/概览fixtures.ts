/**
 * 概览模块自定义 fixture：
 * - base.extend：在 Playwright 内置 page fixture 基础上扩展出 authedPage
 * - fixture 的 use 回调：把恢复登录态的页面交给测试体使用
 * - 每个测试仍然拥有独立的 browser context 和 page，天然隔离
 */
import { test as base, type Page } from '@playwright/test';
import { restoreSessionStorage } from '../登录状态';

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    // fixture 在测试体运行前执行：恢复人工验证码登录后的 sessionStorage
    await restoreSessionStorage(page);
    // use(page) 表示把准备好的页面交给当前测试使用
    await use(page);
  },
});

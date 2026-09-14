/**
 * 模型模块自定义 fixture：
 * - base.extend：在 Playwright 内置 page 基础上扩展出 authedPage
 * - fixture 在测试体运行前恢复人工登录后的 sessionStorage，保证模型页不会被踢回登录页
 * - 每个测试拥有独立 context/page，天然隔离
 */
import { test as base, type Page } from '@playwright/test';
import { restoreSessionStorage } from '../登录状态';

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await restoreSessionStorage(page);
    await use(page);
  },
});

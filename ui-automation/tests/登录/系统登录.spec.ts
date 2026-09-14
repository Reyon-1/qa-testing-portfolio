/**
 * 人工验证码登录并保存状态：
 * - fill：自动填写用户名和密码
 * - page.pause：暂停浏览器，等待人工输入动态验证码并点击登录
 * - toHaveURL：验证登录成功后进入概览页
 * - saveLoginState：保存 Cookie、localStorage、sessionStorage
 *
 * 注意：本用例必须由人工完成动态验证码，不能绕过验证码。
 */
import { test, expect } from '@playwright/test';
import { openLoginPage, expectLoginPage } from './登录测试辅助';
import { saveLoginState } from '../登录状态';

test.describe('登录模块', () => {
  // 本文件会写入登录状态，使用串行模式避免和其他用例同时执行造成状态竞争
  test.describe.configure({ mode: 'serial' });

  test('人工验证码登录并保存登录状态', async ({ page }) => {
    // 强制使用中文语言，避免旧英文状态影响定位和界面
    await page.addInitScript(() => {
      localStorage.setItem('aiops-admin:locale', 'zh-CN');
    });

    await openLoginPage(page);
    await expectLoginPage(page);

    // CSS 定位登录页文本输入框：第 1 个用户名，第 2 个密码，第 3 个图片验证码
    const inputs = page.locator('input:not([type="checkbox"])');

    // fill：模拟用户填写用户名（账号密码从环境变量读取，不写进代码）
    await inputs.nth(0).fill(process.env.TEST_USERNAME ?? 'admin');

    // fill：模拟用户填写密码
    await inputs.nth(1).fill(process.env.TEST_PASSWORD ?? '');

    // page.pause：暂停执行并打开 Playwright 调试器；动态验证码必须人工输入
    await page.pause();

    // 人工点击登录后，等待系统真正进入概览统计页
    await expect(page).toHaveURL(/\/overview\/statistics/, {
      timeout: 120000,
    });

    // 保存登录状态，后续概览用例通过 storageState 复用
    await saveLoginState(page);
  });
});
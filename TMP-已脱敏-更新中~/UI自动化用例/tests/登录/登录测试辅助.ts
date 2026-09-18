/**
 * 登录页公共辅助：
 * - page.goto：打开登录页
 * - waitForURL：等待页面跳转到 /login
 * - Locator：定位用户名、密码、验证码输入框和登录按钮
 * - Web-first Assertions：toHaveTitle / toHaveCount / toBeVisible
 */
import { expect, type Page } from '@playwright/test';

/**
 * 打开管理端登录页。
 * 使用配置中的 baseURL，所以 page.goto('/') 会访问公司测试环境根地址。
 */
export async function openLoginPage(page: Page) {
  await page.goto('/');
  // waitForURL 等待系统完成跳转，确认进入登录路由
  await page.waitForURL(/\/login/);
}

/**
 * 核对登录页固定结构。
 * 这是页面信息核对用例的核心，只验证固定元素，不验证会变化的业务数据。
 */
export async function expectLoginPage(page: Page) {
  // toHaveTitle：自动重试断言浏览器标签页标题
  // expect.soft：标题失败时继续检查后面的输入框和按钮，一次跑出多个问题
  // 当前测试环境会返回 AI 运营管理平台 或 AI Ops Admin 两种真实标题
  await expect.soft(page).toHaveTitle(/AI 运营管理平台|AI Ops Admin/, { timeout: 15000 });

  // 当前登录页没有可访问的 label，因此先用 CSS 定位文本输入框并排除“记住我”复选框
  const inputs = page.locator('input:not([type="checkbox"])');

  // toHaveCount：断言登录页有 3 个文本输入框：用户名、密码、图片验证码
  await expect.soft(inputs).toHaveCount(3, { timeout: 15000 });

  // toBeVisible：逐个断言 3 个输入框真实显示
  await expect.soft(inputs.nth(0)).toBeVisible({ timeout: 15000 });
  await expect.soft(inputs.nth(1)).toBeVisible({ timeout: 15000 });
  await expect.soft(inputs.nth(2)).toBeVisible({ timeout: 15000 });

  // locator('button')：定位页面按钮；登录页当前有刷新验证码、语言设置、立即登录
  const buttons = page.locator('button');
  await expect.soft(buttons).toHaveCount(3, { timeout: 15000 });

  // last()：最后一个按钮是“立即登录”
  await expect.soft(buttons.last()).toBeVisible({ timeout: 15000 });
}

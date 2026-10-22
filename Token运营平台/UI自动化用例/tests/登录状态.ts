/**
 * 登录状态公共辅助：
 * - Playwright storageState：保存/复用 Cookie 和 localStorage
 * - page.evaluate：在浏览器页面内读取 sessionStorage
 * - page.addInitScript：在页面加载前恢复 sessionStorage
 */
import { type Page } from '@playwright/test';
import fs from 'node:fs';

// 登录状态保存路径；user.json 由 Playwright storageState 生成
export const userStatePath = 'playwright/.auth/user.json';
// sessionStorage 不在 storageState 范围内，因此单独保存为 JSON 文件
export const sessionStatePath = 'playwright/.auth/session.json';

/**
 * 保存当前登录状态。
 * 用途：人工输入动态验证码登录成功后，把登录态保存成可复用文件。
 */
export async function saveLoginState(page: Page) {
  // storageState：保存 Cookie 和 localStorage 到指定 JSON 文件
  await page.context().storageState({ path: userStatePath });

  // page.evaluate：在浏览器上下文里读取 window.sessionStorage 的全部键值
  const sessionStorage = await page.evaluate(() =>
    Object.fromEntries(Object.entries(window.sessionStorage))
  );

  // Node.js fs 把 sessionStorage 单独写入文件
  fs.writeFileSync(
    sessionStatePath,
    JSON.stringify(sessionStorage, null, 2),
    'utf-8'
  );
}

/**
 * 在首次导航前恢复 sessionStorage。
 * 用途：storageState 不能保存 sessionStorage，必须由每个测试手动恢复。
 */
export async function restoreSessionStorage(page: Page) {
  if (!fs.existsSync(sessionStatePath)) return;

  const storage = JSON.parse(
    fs.readFileSync(sessionStatePath, 'utf-8')
  ) as Record<string, string>;

  // addInitScript：在页面任何脚本运行前执行，保证页面一加载就能读到登录态
  await page.addInitScript((saved) => {
    for (const [key, value] of Object.entries(saved)) {
      window.sessionStorage.setItem(key, value);
    }
    // 固定中文语言，避免之前保存的英文语言状态影响后续定位
    window.localStorage.setItem('aiops-admin:locale', 'zh-CN');
  }, storage);
}

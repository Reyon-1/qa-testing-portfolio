/**
 * 登录页信息核对用例：
 * - openLoginPage：打开登录页并等待跳转
 * - expectLoginPage：核对标题、输入框、按钮这些固定结构
 * - expect.soft：一个结构失败时继续检查其他结构，便于一次收集多个问题
 */
import { test } from '@playwright/test';
import { openLoginPage, expectLoginPage } from './登录测试辅助';

test.describe('登录模块', () => {
  test('管理端登录页正常显示', async ({ page }) => {
    // 打开管理端登录页，并等待 URL 进入 /login
    await openLoginPage(page);

    // 核对登录页固定结构：标题、3 个输入框、立即登录按钮
    await expectLoginPage(page);
  });
});
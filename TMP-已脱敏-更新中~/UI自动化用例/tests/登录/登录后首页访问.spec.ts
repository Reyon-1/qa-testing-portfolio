/**
 * 登录后复用状态访问概览：
 * - test.use + storageState：复用人工验证码登录后的 Cookie 和 localStorage
 * - authedPage fixture：在页面加载前恢复 sessionStorage
 * - openOverview：开放概览页并验证 URL 和主标题
 */
import { test } from '../概览/概览fixtures';
import { userStatePath } from '../登录状态';
import { openOverview } from '../概览/概览测试辅助';

test.describe('登录模块', () => {
  // test.use：对本文件所有用例统一设置登录状态文件
  test.use({ storageState: userStatePath });

  test('保存的登录状态可以进入概览页', async ({ authedPage: page }) => {
    // openOverview 会等待概览路由、菜单初始化和主标题渲染
    await openOverview(page);
  });
});
/**
 * 概览排行与响应式布局：
 * - setViewportSize：模拟桌面、平板、手机视口
 * - count：统计排行数据行数，验证 TOP5 限制
 * - page.evaluate：读取 document.scrollWidth 检测横向溢出
 * - viewportSize：在测试侧读取视口尺寸，避免在 Node 代码里直接访问 window
 */
import { expect } from '@playwright/test';
import { test } from './概览fixtures';
import { OverviewPage } from './概览测试辅助';
import { userStatePath } from '../登录状态';

test.describe('概览排行与响应式布局', () => {
  test.use({ storageState: userStatePath });

  test('租户排行最多显示5条', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();
    await overview.waitForData();

    // 定位完整排行模块卡片，再统计卡片内的列表行
    const module = overview.getCard('租户运营排行TOP5');
    await expect(module, '租户运营排行TOP5模块未渲染').toBeVisible();

    const rows = module.locator('tr, [role="row"], li');
    const rowCount = await rows.count();
    // 0 条也是合法数据状态；本用例只验证不能超过 5 条
    expect(rowCount, `租户排行实际渲染了${rowCount}条，超过TOP5限制`).toBeLessThanOrEqual(5);

    // 卡片内必须有排行维度字段“调用次数”
    await expect(module, '排行卡片已打开但缺少调用次数字段').toContainText('调用次数');
  });

  // for 循环生成 3 个独立测试，分别覆盖桌面、平板、手机
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    test(`${viewport.width}px布局不横向溢出`, async ({ authedPage: page }) => {
      // setViewportSize：模拟不同设备宽度后再打开概览页
      await page.setViewportSize(viewport);
      const overview = new OverviewPage(page);
      await overview.open();

      // 测试侧读取当前视口宽度，再传给浏览器 evaluate 比较滚动宽度
      const viewportWidth = (await page.viewportSize())?.width ?? viewport.width;
      const overflow = await page.evaluate(
        (expectedWidth) => document.documentElement.scrollWidth > expectedWidth + 1,
        viewportWidth
      );
      expect(overflow, `${viewport.width}px视口出现横向溢出`).toBe(false);

      // 主标题必须有真实布局盒，并且落在视口宽度内
      const heading = overview.mainTitle;
      const box = await heading.boundingBox();
      expect(box, `${viewport.width}px下概览主标题没有可见布局坐标`).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    });
  }
});
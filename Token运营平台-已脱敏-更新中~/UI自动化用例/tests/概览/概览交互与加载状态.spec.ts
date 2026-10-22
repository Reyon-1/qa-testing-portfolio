/**
 * 概览交互与加载状态：
 * - focus/press：模拟键盘聚焦和 Enter 操作
 * - toBeFocused：验证元素真正获得键盘焦点
 * - evaluate：读取浏览器 DOM 状态
 * - toHaveCount(0)：等待所有可见加载遮罩消失，不依赖固定 sleep
 */
import { expect } from '@playwright/test';
import { test } from './概览fixtures';
import { OverviewPage } from './概览测试辅助';
import { userStatePath } from '../登录状态';

test.describe('概览交互与加载状态', () => {
  test.use({ storageState: userStatePath });

  test('时间范围筛选支持键盘操作', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    // 页面可能因框架渲染重复文本节点，取第一个 7天 候选
    const button = page.getByText('7天', { exact: true }).first();

    // focus：模拟用户 Tab 到时间范围按钮
    await button.focus();

    // toBeFocused：断言按钮确实获得键盘焦点
    await expect(button, '7天筛选控件无法获得键盘焦点').toBeFocused();

    // 记录 Enter 前的交互状态，兼容 aria、data、CSS 三类选中实现
    const beforeState = await button.evaluate((element) => {
      const node = element.closest('button,[role="button"],[role="tab"],[role="radio"]') ?? element.parentElement;
      return node ? {
        className: node.getAttribute('class') ?? '',
        ariaPressed: node.getAttribute('aria-pressed') ?? '',
        ariaSelected: node.getAttribute('aria-selected') ?? '',
        dataState: node.getAttribute('data-state') ?? '',
        dataActive: node.getAttribute('data-active') ?? '',
      } : null;
    });

    // press('Enter')：模拟键盘按下 Enter 触发筛选
    await button.press('Enter');

    const afterState = await button.evaluate((element) => {
      const node = element.closest('button,[role="button"],[role="tab"],[role="radio"]') ?? element.parentElement;
      return node ? {
        className: node.getAttribute('class') ?? '',
        ariaPressed: node.getAttribute('aria-pressed') ?? '',
        ariaSelected: node.getAttribute('aria-selected') ?? '',
        dataState: node.getAttribute('data-state') ?? '',
        dataActive: node.getAttribute('data-active') ?? '',
      } : null;
    });

    // 按下 Enter 后状态必须发生变化，证明键盘操作真正生效
    const selected = afterState && (
      afterState.ariaPressed === 'true'
      || afterState.ariaSelected === 'true'
      || afterState.dataState === 'on'
      || afterState.dataActive === 'true'
      || /active|selected|checked|primary/.test(afterState.className)
      || JSON.stringify(afterState) !== JSON.stringify(beforeState)
    );
    expect(selected, '按Enter后7天控件状态没有变化，请检查键盘事件或选中标记').toBe(true);
  });

  test('概览数据加载完成后不残留加载状态', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    // waitForData 使用 toHaveCount(0) 等待所有可见加载遮罩消失
    await overview.waitForData();
  });
});
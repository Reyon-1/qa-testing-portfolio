/**
 * 概览指标与租户筛选：
 * - Locator 链式定位：先定位卡片，再在卡片内定位租户选择器
 * - getByRole：使用 combobox/option 等无障碍角色定位交互控件
 * - waitForRequest：验证筛选操作确实触发了新的接口请求
 * - requestSignature：比较请求签名，防止旧请求被误判成新请求
 */
import { expect } from '@playwright/test';
import { test } from './概览fixtures';
import { OverviewPage, recordApiRequests, requestSignature } from './概览测试辅助';
import { userStatePath } from '../登录状态';

test.describe('概览指标与租户筛选', () => {
  test.use({ storageState: userStatePath });

  test('切换Token数量和API次数后触发指标变化请求', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);
    const overview = new OverviewPage(page);
    await overview.open();

    // 记录点击前的请求签名
    const before = requests.map(requestSignature);

    // waitForRequest 在点击前注册，捕获指标切换触发的接口请求
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/'),
      { timeout: 10000 }
    );

    // 模拟用户切换指标模式
    await page.getByText('Token数量', { exact: true }).first().click();
    await page.getByText('API次数', { exact: true }).first().click();

    const request = await requestPromise;
    const signature = requestSignature({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
    });

    // 请求签名必须不在点击前列表中，证明筛选条件真的触发重新查询
    expect(before, '指标切换没有产生新的查询签名').not.toContain(signature);

    // 最终页面状态仍要存在：模型调用/消耗分布模块必须显示
    const distributionCard = overview.getCard('模型调用/消耗分布');
    await expect(distributionCard, '模型调用/消耗分布模块不可见').toBeVisible();
  });

  test('切换租户下拉选项后触发图表数据请求', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);
    const overview = new OverviewPage(page);
    await overview.open();

    // 等待加载遮罩消失，避免遮罩退出动画拦截后续下拉点击
    await overview.waitForData();

    // 先定位问题分布图卡片，再在卡片内定位租户选择器
    const problemCard = overview.getCard('问题分布图');
    await expect(problemCard, '概览页未找到问题分布图卡片').toBeVisible();

    // Element Plus 的 el-select 由 combobox 输入框承接点击
    const tenantSelect = problemCard
      .locator('.el-select')
      .filter({ hasText: '全部租户' })
      .first();
    await expect(tenantSelect, '概览页未找到全部租户筛选器').toBeVisible();

    const tenantCombobox = tenantSelect.getByRole('combobox');
    await expect(tenantCombobox, '全部租户筛选器缺少 combobox 输入框').toBeVisible();
    await tenantCombobox.click();

    // 下拉选项通过 Portal 挂到 body；排除当前值“全部租户”，保证切换真正发生
    const options = page
      .locator('[role="option"]:visible, .el-select-dropdown__item:visible')
      .filter({ hasNotText: '全部租户' });

    // 下拉打开后必须有另一个租户；没有数据时给出明确前置条件错误
    await expect(options.first(), '当前环境缺少可切换的其他租户数据')
      .toBeVisible({ timeout: 5000 });

    const before = requests.map(requestSignature);
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/'),
      { timeout: 10000 }
    );

    // 点击第一个其他租户
    await options.first().click();

    const request = await requestPromise;
    const signature = requestSignature({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
    });

    expect(before, '租户筛选没有产生新的查询签名').not.toContain(signature);

    // 最终页面状态仍要存在：平台调用趋势模块必须显示
    const trendCard = overview.getCard('平台调用趋势');
    await expect(trendCard, '租户筛选后平台调用趋势模块不可见').toBeVisible();
  });
});
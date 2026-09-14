/**
 * 模型模块 - 模型提供商 页面结构与查询：
 * - ModelListPage：列表页 Page Object，封装打开、搜索、重置
 * - expectTableHeaders：基于实测表头逐列断言
 * - recordApiRequests / findApiRequest：验证"用户操作确实触发了目标接口"
 * - getByPlaceholder / getByRole：可访问性优先的稳定定位方式
 */
import { expect } from '@playwright/test';
import { test } from './模型fixtures';
import {
  ModelListPage,
  vendorConfig,
  modelRoutes,
  expectTableHeaders,
  tableRows,
  emptyText,
  waitForTableReady,
} from './模型测试辅助';
import { userStatePath } from '../登录状态';
import { recordApiRequests, findApiRequest } from '../接口监听';

/** 稳定不存在的关键词，避免和真实数据撞名 */
const 不存在的提供商 = 'zzz_automation_not_exist_provider_zzz';

test.describe('模型模块 - 模型提供商 页面结构与查询', () => {
  test.use({ storageState: userStatePath });

  test('页面正常打开并展示完整固定模块', async ({ authedPage: page }) => {
    const providers = new ModelListPage(page, vendorConfig);
    await providers.open();

    // 主标题
    await expect(providers.title, '模型提供商主标题未显示').toBeVisible();

    // 三个固定操作入口
    await expect(providers.createButton, '"新建提供商"按钮未显示').toBeVisible();
    await expect(providers.searchInput, '提供商名称搜索框未显示').toBeVisible();
    await expect(providers.searchButton, '"搜索"按钮未显示').toBeVisible();
    await expect(providers.resetButton, '"重置"按钮未显示').toBeVisible();

    // 表格列头逐列核对
    await expectTableHeaders(page, vendorConfig.headers);
  });

  test('首屏加载调用提供商分页接口', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);

    const providers = new ModelListPage(page, vendorConfig);
    await providers.open();

    // 必须真实观察到 POST /api/vendor/page，而不是只看页面有没有出表格
    const pageRequest = findApiRequest(requests, 'POST', vendorConfig.listApi.path);
    expect(
      pageRequest,
      `未观察到 ${vendorConfig.listApi.method} ${vendorConfig.listApi.path} 请求`
    ).toBeTruthy();

    // 分页请求体应带 current / size
    expect(pageRequest!.postData ?? '', '分页请求体缺少分页参数').toMatch(/current/);
  });

  test('搜索不存在的提供商名称展示空结果', async ({ authedPage: page }) => {
    const providers = new ModelListPage(page, vendorConfig);
    await providers.open();

    const before = await providers.rows.count();
    expect(before, '搜索前列表应至少有数据').toBeGreaterThan(0);

    await providers.search(不存在的提供商);

    // 空态：要么 0 行，要么出现空数据提示
    const rowCount = await tableRows(page).count();
    const hasEmptyTip = await emptyText(page).first().isVisible().catch(() => false);
    expect(
      rowCount === 0 || hasEmptyTip,
      `搜索不存在的名称后仍返回 ${rowCount} 行，且没有空数据提示`
    ).toBe(true);
  });

  test('搜索请求体携带关键词', async ({ authedPage: page }) => {
    const providers = new ModelListPage(page, vendorConfig);
    await providers.open();

    const requests = recordApiRequests(page);
    await providers.search(不存在的提供商);

    const searchRequest = findApiRequest(requests, 'POST', vendorConfig.listApi.path);
    expect(searchRequest, '搜索未触发提供商分页接口').toBeTruthy();
    expect(
      searchRequest!.postData ?? '',
      '搜索请求体没有携带搜索关键词，说明搜索条件没有真正下发到后端'
    ).toContain(不存在的提供商);
  });

  test('重置后列表恢复原有数据量', async ({ authedPage: page }) => {
    const providers = new ModelListPage(page, vendorConfig);
    await providers.open();

    const before = await providers.rows.count();
    expect(before, '重置前列表应至少有数据').toBeGreaterThan(0);

    await providers.search(不存在的提供商);
    await providers.reset();

    const after = await providers.rows.count();
    expect(after, `重置后数据量未恢复：重置前 ${before} 行，重置后 ${after} 行`).toBe(before);
  });

  test('分页控件渲染并可切换页码', async ({ authedPage: page }) => {
    const providers = new ModelListPage(page, vendorConfig);
    await providers.open();

    const pagination = page.locator('.el-pagination');
    await expect(pagination, '分页控件未渲染').toBeVisible();

    // 页码按钮
    const pageButtons = page.locator('.el-pager li');
    expect(await pageButtons.count(), '分页控件没有页码按钮').toBeGreaterThan(0);

    // 有第二页时才验证翻页，数据不足时跳过
    const second = pageButtons.filter({ hasText: /^2$/ }).first();
    if (!(await second.isVisible().catch(() => false))) {
      test.skip(true, '当前数据量不足两页，跳过翻页验证');
    }

    await second.click();
    await waitForTableReady(page);

    await expect(second, '点击第二页后页码未进入选中态').toHaveClass(/is-active/);
  });

  test('点击新建提供商跳转到新建页', async ({ authedPage: page }) => {
    const providers = new ModelListPage(page, vendorConfig);
    await providers.open();

    const url = await providers.openCreate();

    expect(url, '点击"新建提供商"未跳转到创建页').toContain(
      modelRoutes.providerCreate
    );
    await expect(
      page.getByText('新建提供商', { exact: true }).first(),
      '新建提供商页标题未渲染'
    ).toBeVisible({ timeout: 15000 });
  });
});

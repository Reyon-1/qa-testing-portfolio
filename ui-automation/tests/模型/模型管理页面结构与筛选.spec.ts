/**
 * 模型模块 - 模型管理 页面结构与筛选：
 * - 模型管理页没有"新建"入口，模型随提供商创建，因此只验证查询侧
 * - 验证按模型名称搜索、重置恢复，以及来源字典接口被正确调用
 */
import { expect } from '@playwright/test';
import { test } from './模型fixtures';
import {
  ModelListPage,
  catalogConfig,
  expectTableHeaders,
  tableRows,
  emptyText,
} from './模型测试辅助';
import { userStatePath } from '../登录状态';
import { recordApiRequests, findApiRequest } from '../接口监听';

const 不存在的模型 = 'zzz_automation_not_exist_model_zzz';

test.describe('模型模块 - 模型管理 页面结构与筛选', () => {
  test.use({ storageState: userStatePath });

  test('页面正常打开并展示完整固定模块', async ({ authedPage: page }) => {
    const catalog = new ModelListPage(page, catalogConfig);
    await catalog.open();

    await expect(catalog.title, '模型管理主标题未显示').toBeVisible();

    // 模型管理页没有"新建"按钮，模型名称与提供商名称两个查询条件必须存在
    await expect(catalog.searchInput, '模型名称搜索框未显示').toBeVisible();
    await expect(
      page.getByPlaceholder('提供商名称').first(),
      '提供商筛选框未显示'
    ).toBeVisible();

    await expectTableHeaders(page, catalogConfig.headers);
  });

  test('首屏加载调用模型分页接口', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);

    const catalog = new ModelListPage(page, catalogConfig);
    await catalog.open();

    const pageRequest = findApiRequest(requests, 'POST', catalogConfig.listApi.path);
    expect(
      pageRequest,
      `未观察到 ${catalogConfig.listApi.method} ${catalogConfig.listApi.path} 请求`
    ).toBeTruthy();
  });

  test('加载来源字典用于表格来源列渲染', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);

    const catalog = new ModelListPage(page, catalogConfig);
    await catalog.open();

    // "来源"列的"管理方/供给方"取值来自字典接口
    const dictRequest = findApiRequest(requests, 'GET', '/api/dict/list/model_source');
    expect(dictRequest, '未调用型号来源字典接口 /api/dict/list/model_source').toBeTruthy();
  });

  test('搜索不存在的模型名称展示空结果', async ({ authedPage: page }) => {
    const catalog = new ModelListPage(page, catalogConfig);
    await catalog.open();

    const before = await catalog.rows.count();
    expect(before, '搜索前列表应至少有数据').toBeGreaterThan(0);

    await catalog.search(不存在的模型);

    const rowCount = await tableRows(page).count();
    const hasEmptyTip = await emptyText(page).first().isVisible().catch(() => false);
    expect(
      rowCount === 0 || hasEmptyTip,
      `搜索不存在的模型名称后仍返回 ${rowCount} 行，且没有空数据提示`
    ).toBe(true);
  });

  test('重置后列表恢复原有数据量', async ({ authedPage: page }) => {
    const catalog = new ModelListPage(page, catalogConfig);
    await catalog.open();

    const before = await catalog.rows.count();
    expect(before, '重置前列表应至少有数据').toBeGreaterThan(0);

    await catalog.search(不存在的模型);
    await catalog.reset();

    const after = await catalog.rows.count();
    expect(after, `重置后数据量未恢复：重置前 ${before} 行，重置后 ${after} 行`).toBe(before);
  });
});

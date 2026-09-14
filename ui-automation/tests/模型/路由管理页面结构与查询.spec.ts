/**
 * 模型模块 - 路由管理 页面结构与查询：
 * - 验证列表结构、路由名称搜索、重置恢复
 * - 验证"新建路由"入口跳转到独立新建路由（实测为 /models/routing/create）
 */
import { expect } from '@playwright/test';
import { test } from './模型fixtures';
import {
  ModelListPage,
  routingConfig,
  modelRoutes,
  expectTableHeaders,
  tableRows,
  emptyText,
} from './模型测试辅助';
import { userStatePath } from '../登录状态';
import { recordApiRequests, findApiRequest } from '../接口监听';

const 不存在的路由 = 'zzz_automation_not_exist_route_zzz';

test.describe('模型模块 - 路由管理 页面结构与查询', () => {
  test.use({ storageState: userStatePath });

  test('页面正常打开并展示完整固定模块', async ({ authedPage: page }) => {
    const routes = new ModelListPage(page, routingConfig);
    await routes.open();

    await expect(routes.title, '路由管理主标题未显示').toBeVisible();
    await expect(routes.createButton, '"新建路由"按钮未显示').toBeVisible();
    await expect(routes.searchInput, '路由名称搜索框未显示').toBeVisible();
    await expect(routes.searchButton, '"搜索"按钮未显示').toBeVisible();
    await expect(routes.resetButton, '"重置"按钮未显示').toBeVisible();

    await expectTableHeaders(page, routingConfig.headers);
  });

  test('首屏加载调用路由分页接口', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);

    const routes = new ModelListPage(page, routingConfig);
    await routes.open();

    const pageRequest = findApiRequest(requests, 'POST', routingConfig.listApi.path);
    expect(
      pageRequest,
      `未观察到 ${routingConfig.listApi.method} ${routingConfig.listApi.path} 请求`
    ).toBeTruthy();
  });

  test('搜索不存在的路由名称展示空结果', async ({ authedPage: page }) => {
    const routes = new ModelListPage(page, routingConfig);
    await routes.open();

    const before = await routes.rows.count();
    expect(before, '搜索前列表应至少有数据').toBeGreaterThan(0);

    await routes.search(不存在的路由);

    const rowCount = await tableRows(page).count();
    const hasEmptyTip = await emptyText(page).first().isVisible().catch(() => false);
    expect(
      rowCount === 0 || hasEmptyTip,
      `搜索不存在的路由名称后仍返回 ${rowCount} 行，且没有空数据提示`
    ).toBe(true);
  });

  test('重置后列表恢复原有数据量', async ({ authedPage: page }) => {
    const routes = new ModelListPage(page, routingConfig);
    await routes.open();

    const before = await routes.rows.count();
    expect(before, '重置前列表应至少有数据').toBeGreaterThan(0);

    await routes.search(不存在的路由);
    await routes.reset();

    const after = await routes.rows.count();
    expect(after, `重置后数据量未恢复：重置前 ${before} 行，重置后 ${after} 行`).toBe(before);
  });

  test('点击新建路由跳转到新建页', async ({ authedPage: page }) => {
    const routes = new ModelListPage(page, routingConfig);
    await routes.open();

    const url = await routes.openCreate();

    expect(url, '点击"新建路由"未跳转到创建页').toContain(modelRoutes.routeCreate);
    await expect(
      page.getByText('新建路由', { exact: true }).first(),
      '新建路由页标题未渲染'
    ).toBeVisible({ timeout: 15000 });
  });
});

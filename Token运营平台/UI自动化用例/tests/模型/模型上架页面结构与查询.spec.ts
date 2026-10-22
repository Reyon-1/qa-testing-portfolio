/**
 * 模型模块 - 模型上架 页面结构与查询：
 * - 验证列表结构、模型名称搜索、重置恢复
 * - 验证"新建上架"入口跳转到独立新建路由（实测为 /models/offerings/create）
 * - 注意：本文件只做查询侧验证，不在测试环境创建真实上架数据
 */
import { expect } from '@playwright/test';
import { test } from './模型fixtures';
import {
  ModelListPage,
  offeringConfig,
  modelRoutes,
  expectTableHeaders,
  tableRows,
  emptyText,
} from './模型测试辅助';
import { userStatePath } from '../登录状态';
import { recordApiRequests, findApiRequest } from '../接口监听';

const 不存在的上架模型 = 'zzz_automation_not_exist_product_zzz';

test.describe('模型模块 - 模型上架 页面结构与查询', () => {
  test.use({ storageState: userStatePath });

  test('页面正常打开并展示完整固定模块', async ({ authedPage: page }) => {
    const products = new ModelListPage(page, offeringConfig);
    await products.open();

    await expect(products.title, '模型上架主标题未显示').toBeVisible();
    await expect(products.createButton, '"新建上架"按钮未显示').toBeVisible();
    await expect(products.searchInput, '模型名称搜索框未显示').toBeVisible();
    await expect(products.searchButton, '"搜索"按钮未显示').toBeVisible();
    await expect(products.resetButton, '"重置"按钮未显示').toBeVisible();

    await expectTableHeaders(page, offeringConfig.headers);
  });

  test('首屏加载调用上架产品分页接口', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);

    const products = new ModelListPage(page, offeringConfig);
    await products.open();

    const pageRequest = findApiRequest(requests, 'POST', offeringConfig.listApi.path);
    expect(
      pageRequest,
      `未观察到 ${offeringConfig.listApi.method} ${offeringConfig.listApi.path} 请求`
    ).toBeTruthy();
  });

  test('加载计费与币种字典用于单价列渲染', async ({ authedPage: page }) => {
    const requests = recordApiRequests(page);

    const products = new ModelListPage(page, offeringConfig);
    await products.open();

    // 单价列的"按Token/按时长"与货币符号来自字典和币种接口
    expect(
      findApiRequest(requests, 'GET', '/api/dict/list/token_price_unit'),
      '未调用计费方式字典接口 token_price_unit'
    ).toBeTruthy();
    expect(
      findApiRequest(requests, 'GET', '/api/config/currency/list'),
      '未调用币种接口 listCurrency'
    ).toBeTruthy();
  });

  test('搜索不存在的模型名称展示空结果', async ({ authedPage: page }) => {
    const products = new ModelListPage(page, offeringConfig);
    await products.open();

    const before = await products.rows.count();
    expect(before, '搜索前列表应至少有数据').toBeGreaterThan(0);

    await products.search(不存在的上架模型);

    const rowCount = await tableRows(page).count();
    const hasEmptyTip = await emptyText(page).first().isVisible().catch(() => false);
    expect(
      rowCount === 0 || hasEmptyTip,
      `搜索不存在的模型名称后仍返回 ${rowCount} 行，且没有空数据提示`
    ).toBe(true);
  });

  test('重置后列表恢复原有数据量', async ({ authedPage: page }) => {
    const products = new ModelListPage(page, offeringConfig);
    await products.open();

    const before = await products.rows.count();
    expect(before, '重置前列表应至少有数据').toBeGreaterThan(0);

    await products.search(不存在的上架模型);
    await products.reset();

    const after = await products.rows.count();
    expect(after, `重置后数据量未恢复：重置前 ${before} 行，重置后 ${after} 行`).toBe(before);
  });

  test('点击新建上架跳转到新建页', async ({ authedPage: page }) => {
    const products = new ModelListPage(page, offeringConfig);
    await products.open();

    const url = await products.openCreate();

    expect(url, '点击"新建上架"未跳转到创建页').toContain(modelRoutes.productCreate);
    await expect(
      page.getByText('新建上架', { exact: true }).first(),
      '新建上架页标题未渲染'
    ).toBeVisible({ timeout: 15000 });
  });
});

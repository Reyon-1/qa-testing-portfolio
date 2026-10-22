/**
 * 模型模块公共辅助：
 * - 路由与标题常量：全部来自服务端菜单接口 /api/role/menu-tree/1 的真实数据，不是猜测
 * - ModelListPage：列表页通用 Page Object，封装打开页面、搜索、重置、读表头、读行
 * - 表单辅助：新建页（独立路由，不是弹窗）的字段读取与断言
 *
 * 已验证的事实（2026-09-14 实测）：
 * - "新建"按钮点击后跳转到独立路由，如 /models/vendors/create，不是弹窗
 * - 四个列表页各自的接口、表头、搜索框 placeholder 见下方 config
 */
import { expect, type Page, type Locator } from '@playwright/test';
import { restoreSessionStorage } from '../登录状态';

/* ------------------------------------------------------------------ *
 * 一、路由与标题（来源：/api/role/menu-tree/1 菜单树）
 * ------------------------------------------------------------------ */

export const modelRoutes = {
  providers: '/models/vendors',
  catalog: '/models/catalog',
  products: '/models/offerings',
  routes: '/models/routing',
  /** 以下新建页路由由实测点击"新建"按钮得到 */
  providerCreate: '/models/vendors/create',
  productCreate: '/models/offerings/create',
  routeCreate: '/models/routing/create',
} as const;

export const modelTitles = {
  providers: '模型提供商',
  catalog: '模型管理',
  products: '模型上架',
  routes: '路由管理',
} as const;

/* ------------------------------------------------------------------ *
 * 二、列表页配置（表头/搜索框/接口均为实测值）
 * ------------------------------------------------------------------ */

export type ListPageConfig = {
  route: string;
  title: string;
  /** 搜索输入框 placeholder；没有独立搜索框的页面传 undefined */
  searchPlaceholder?: string;
  /** "新建"按钮文案；模型管理页没有新建入口 */
  createButton?: string;
  /** 是否有"搜索/重置"按钮组 */
  hasSearchButtons: boolean;
  /** 表格列头（实测） */
  headers: string[];
  /** 列表数据接口 */
  listApi: { method: string; path: string };
};

export const vendorConfig: ListPageConfig = {
  route: modelRoutes.providers,
  title: modelTitles.providers,
  searchPlaceholder: '请输入提供商名称',
  createButton: '新建提供商',
  hasSearchButtons: true,
  headers: ['提供商名称', '类型', '来源', '状态', '响应速度', '最近测试', '创建日期', '操作'],
  listApi: { method: 'POST', path: '/api/vendor/page' },
};

export const catalogConfig: ListPageConfig = {
  route: modelRoutes.catalog,
  title: modelTitles.catalog,
  searchPlaceholder: '请输入模型名称',
  createButton: undefined,
  hasSearchButtons: true,
  headers: ['模型名称', '提供商', '来源', '状态', '响应', '上次测试时间', '创建时间', '操作'],
  listApi: { method: 'POST', path: '/api/model/page' },
};

export const offeringConfig: ListPageConfig = {
  route: modelRoutes.products,
  title: modelTitles.products,
  searchPlaceholder: '请输入模型名称',
  createButton: '新建上架',
  hasSearchButtons: true,
  headers: ['模型名称', '提供商', '来源', '模型类型', '状态', '计费方式', '单价', '排序', '操作'],
  listApi: { method: 'POST', path: '/api/model-offering/page' },
};

export const routingConfig: ListPageConfig = {
  route: modelRoutes.routes,
  title: modelTitles.routes,
  searchPlaceholder: '搜索路由名称',
  createButton: '新建路由',
  hasSearchButtons: true,
  headers: ['路由名称', '类型', '模型提供商', '复杂度层配置', '状态', '更新时间', '操作'],
  listApi: { method: 'POST', path: '/api/model-routing/page' },
};

/* ------------------------------------------------------------------ *
 * 三、页面打开与等待
 * ------------------------------------------------------------------ */

/**
 * 打开模型模块某个页面并确认页面真正可用。
 * "可用"指：路由正确、菜单没有初始化失败、页面主标题已渲染。
 */
export async function openModelPage(page: Page, route: string, title: string) {
  await restoreSessionStorage(page);
  await page.goto(route, { waitUntil: 'domcontentloaded' });

  // 确认没有被登录拦截跳回 /login
  await expect(page, `打开 ${route} 后被重定向到登录页`).toHaveURL(
    new RegExp(route.replace(/\//g, '\\/'))
  );

  // 先识别菜单初始化失败，避免把前置问题误报成模型模块问题
  const menuFailure = page.getByText('暂无可用菜单，请稍后重试重新加载菜单', { exact: true });
  if (await menuFailure.isVisible().catch(() => false)) {
    throw new Error('模型模块前置条件失败：菜单接口不可用或响应格式异常');
  }

  await expect(
    page.getByText(title, { exact: true }).first(),
    `页面未渲染标题：${title}`
  ).toBeVisible({ timeout: 20000 });
}

/**
 * 等待列表数据加载完成。
 * 用可见加载遮罩数量归零来判断，不用固定 sleep。
 */
export async function waitForTableReady(page: Page) {
  const visibleLoading = page.locator(
    '.el-loading-mask:visible, [aria-busy="true"]:visible, [role="progressbar"]:visible'
  );
  await expect(visibleLoading, '列表数据仍在加载').toHaveCount(0, { timeout: 20000 });

  await expect(page.locator('.el-table').first(), '未渲染表格').toBeVisible({
    timeout: 20000,
  });
}

/* ------------------------------------------------------------------ *
 * 四、表格读取
 * ------------------------------------------------------------------ */

/**
 * 读取表格列头。
 * Element Plus 在固定列场景下会重复渲染表头，因此去重后返回。
 */
export async function readTableHeaders(page: Page): Promise<string[]> {
  const texts = await page.locator('.el-table__header th .cell').allInnerTexts();
  const cleaned = texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(cleaned)];
}

/** 断言表格包含全部预期列头 */
export async function expectTableHeaders(page: Page, headers: string[]) {
  const got = await readTableHeaders(page);
  for (const header of headers) {
    expect(got, `表格缺少列头：${header}（实际：${got.join(' / ')}）`).toContain(header);
  }
}

/** 当前页可见数据行 */
export function tableRows(page: Page): Locator {
  return page.locator('.el-table__body tbody tr');
}

/** 表格空数据提示 */
export function emptyText(page: Page): Locator {
  return page.locator('.el-table__empty-text, .el-table__empty-block');
}

/* ------------------------------------------------------------------ *
 * 五、列表页 Page Object
 * ------------------------------------------------------------------ */

export class ModelListPage {
  readonly page: Page;
  readonly config: ListPageConfig;

  constructor(page: Page, config: ListPageConfig) {
    this.page = page;
    this.config = config;
  }

  /** 打开列表页并等待数据就绪 */
  async open() {
    await openModelPage(this.page, this.config.route, this.config.title);
    await waitForTableReady(this.page);
  }

  /** 页面主标题 */
  get title() {
    return this.page.getByText(this.config.title, { exact: true }).first();
  }

  /** "新建"入口按钮（模型管理页不存在） */
  get createButton(): Locator {
    const name = this.config.createButton;
    if (!name) throw new Error(`${this.config.title} 页面没有"新建"入口`);
    return this.page.getByRole('button', { name, exact: true }).first();
  }

  get searchInput(): Locator {
    const ph = this.config.searchPlaceholder;
    if (!ph) throw new Error(`${this.config.title} 页面没有搜索框`);
    return this.page.getByPlaceholder(ph).first();
  }

  get searchButton(): Locator {
    return this.page.getByRole('button', { name: '搜索', exact: true }).first();
  }

  get resetButton(): Locator {
    return this.page.getByRole('button', { name: '重置', exact: true }).first();
  }

  get rows(): Locator {
    return tableRows(this.page);
  }

  /** 执行搜索：填入关键词并点击搜索，等待列表接口返回 */
  async search(keyword: string) {
    await this.searchInput.fill(keyword);
    const responsePromise = this.page.waitForResponse(
      (r) =>
        r.request().method().toUpperCase() === this.config.listApi.method.toUpperCase() &&
        r.url().includes(this.config.listApi.path),
      { timeout: 20000 }
    );
    await this.searchButton.click();
    await responsePromise;
    await waitForTableReady(this.page);
  }

  /** 点击重置，等待列表接口重新返回 */
  async reset() {
    const responsePromise = this.page.waitForResponse(
      (r) =>
        r.request().method().toUpperCase() === this.config.listApi.method.toUpperCase() &&
        r.url().includes(this.config.listApi.path),
      { timeout: 20000 }
    );
    await this.resetButton.click();
    await responsePromise;
    await waitForTableReady(this.page);
  }

  /** 点"新建"进入新建页，返回实际跳转到的 URL */
  async openCreate(): Promise<string> {
    await this.createButton.click();
    await this.page.waitForTimeout(1500);
    return this.page.url();
  }
}

/* ------------------------------------------------------------------ *
 * 六、新建页表单辅助
 * ------------------------------------------------------------------ */

/**
 * 读取表单字段 label。
 * 归一化：去掉全部空白，并去掉 Element Plus 帮助问号后缀（如 "RPM ?" -> "RPM"）。
 */
export async function readFormLabels(page: Page): Promise<string[]> {
  const texts = await page.locator('.el-form-item__label').allInnerTexts();
  return texts
    .map((t) => t.replace(/\s+/g, '').replace(/[?？]$/, ''))
    .filter(Boolean);
}

/** 断言表单包含全部预期字段 */
export async function expectFormLabels(page: Page, labels: string[]) {
  const got = await readFormLabels(page);
  for (const label of labels) {
    const normalized = label.replace(/\s+/g, '');
    expect(
      got,
      `表单缺少字段：${label}（实际：${got.join(' / ')}）`
    ).toContain(normalized);
  }
}

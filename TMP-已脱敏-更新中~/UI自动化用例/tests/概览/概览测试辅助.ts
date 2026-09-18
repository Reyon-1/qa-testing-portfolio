/**
 * 概览页公共辅助：
 * - Playwright Page API：页面导航、事件监听
 * - Locator 链式定位：article.filter 定位完整图表卡片
 * - Web-first Assertions：等待页面最终状态，不用固定 sleep
 * - request 事件：记录并比较接口请求签名
 */
import { expect, type Page } from '@playwright/test';
import { restoreSessionStorage } from '../登录状态';

export const overviewUrl = '/overview/statistics';

/**
 * 打开概览页并等待页面真正可用。
 * 这里的“可用”指：路由正确、菜单没有失败、主标题已经渲染。
 */
export async function openOverview(page: Page) {
  // 恢复人工验证码登录后额外保存的 sessionStorage
  await restoreSessionStorage(page);

  // page.goto 使用配置中的 baseURL 拼接概览路由
  await page.goto(overviewUrl, { waitUntil: 'domcontentloaded' });

  // toHaveURL：确认没有被登录拦截跳回 /login
  await expect(page).toHaveURL(/\/overview\/statistics/);

  // 先识别菜单初始化失败，避免把前置问题误报成概览模块问题
  const menuFailure = page.getByText('暂无可用菜单，请稍后重试重新加载菜单', { exact: true });
  if (await menuFailure.isVisible().catch(() => false)) {
    throw new Error('概览前置条件失败：菜单接口不可用或响应格式异常');
  }

  // 定位概览主标题；页面可能因框架渲染出重复文本节点，所以取第一个可见候选
  const mainTitle = page.getByText('AI运营统计', { exact: true }).first();
  await expect(mainTitle, '概览页未渲染 AI运营统计 主标题').toBeVisible({ timeout: 15000 });
}

/**
 * 等待概览数据加载完成。
 * 使用 :visible 过滤真正可见的加载遮罩，再等待可见遮罩数量归零。
 */
export async function waitForOverviewData(page: Page) {
  const visibleLoading = page.locator(
    '[aria-busy="true"]:visible, ' +
      '[role="progressbar"]:visible, ' +
      '.loading:visible, ' +
      '.loading-mask:visible, ' +
      '.el-loading-mask:visible'
  );
  // toHaveCount(0)：自动等待所有加载遮罩消失，避免固定 sleep 和严格模式错误
  await expect(visibleLoading, '概览数据仍在加载').toHaveCount(0, { timeout: 15000 });
}

/**
 * 根据卡片标题定位完整图表卡片。
 * 必须定位 article 完整卡片，不能只定位几十像素高的标题栏。
 */
export function chartCard(page: Page, title: string) {
  return page.locator('article').filter({ hasText: title }).first();
}

/**
 * 概览页面对象（Page Object）：
 * 把“打开页面、找主标题、找图表卡片、等数据”封装成可复用方法。
 * 测试体只描述业务步骤，不重复写页面定位细节。
 */
export class OverviewPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open() {
    await openOverview(this.page);
  }

  get mainTitle() {
    return this.page.getByText('AI运营统计', { exact: true }).first();
  }

  getCard(title: string) {
    return chartCard(this.page, title);
  }

  async waitForData() {
    await waitForOverviewData(this.page);
  }
}

export type ApiRequestRecord = { url: string; method: string; postData: string | null };

/**
 * 生成请求签名。
 * 用途：把 URL、方法和请求体拼成字符串，用于证明筛选操作真的触发了新请求。
 */
export function requestSignature(request: ApiRequestRecord) {
  return `${request.method} ${request.url} ${request.postData ?? ''}`;
}

/**
 * 注册 request 事件监听，记录页面后续发出的 /api/ 请求。
 */
export function recordApiRequests(page: Page) {
  const requests: ApiRequestRecord[] = [];

  // page.on('request')：在浏览器发出请求时回调，不修改任何真实请求
  page.on('request', (request) => {
    if (request.url().includes('/api/')) {
      requests.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData(),
      });
    }
  });

  return requests;
}

/**
 * 接口监听公共辅助（跨模块复用）：
 * - page.on('request')：记录页面真实发出的接口请求，用于断言"用户操作确实触发了目标接口"
 * - requestSignature：把 method + url + body 拼成签名，用于比较操作前后是否产生新请求
 * - waitForApi：等待某个具体接口返回，避免用固定 sleep 猜时间
 */
import { type Page, type Response } from '@playwright/test';

export type ApiRequestRecord = {
  url: string;
  method: string;
  postData: string | null;
};

/**
 * 注册 request 监听，记录页面后续发出的所有 /api/ 请求。
 * 注意：只记录，不修改、不拦截任何真实请求。
 */
export function recordApiRequests(page: Page): ApiRequestRecord[] {
  const requests: ApiRequestRecord[] = [];

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

/**
 * 生成请求签名，用于证明筛选/搜索操作真的触发了新的接口调用。
 */
export function requestSignature(request: ApiRequestRecord): string {
  return `${request.method} ${request.url} ${request.postData ?? ''}`;
}

/**
 * 在已记录的请求中查找匹配的目标接口。
 * method 传 HTTP 方法，pathPart 传路径片段（不需要完整 URL）。
 */
export function findApiRequest(
  requests: ApiRequestRecord[],
  method: string,
  pathPart: string
): ApiRequestRecord | undefined {
  return requests.find(
    (r) => r.method === method.toUpperCase() && r.url.includes(pathPart)
  );
}

/**
 * 等待某个接口返回。
 * 用途：点击"搜索"后等待列表接口真正返回，再断言页面结果，避免时序竞态。
 */
export function waitForApi(
  page: Page,
  method: string,
  pathPart: string
): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method().toUpperCase() === method.toUpperCase() &&
      response.url().includes(pathPart),
    { timeout: 20000 }
  );
}

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 基础阶段配置：
 * - testDir：告诉 Playwright 扫描哪个目录下的 *.spec.ts
 * - timeout：单个用例的总超时时间，超过后用例失败
 * - expect.timeout：断言自动等待的最长时间
 * - retries：用例失败后的重试次数，本地开发先设 0
 * - workers：同时使用几个 worker 跑测试，先设 1 保证登录状态稳定
 * - reporter：控制台输出 list，失败后生成 HTML 报告
 * - outputDir：失败截图、视频、trace 等产物的输出目录
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  outputDir: 'test-results',

  use: {
    // baseURL：让 page.goto('/overview/statistics') 自动拼接测试环境地址。
    // 真实环境地址通过环境变量 BASE_URL 注入，不写死在代码里（示例地址为占位符）
    baseURL: process.env.BASE_URL ?? 'http://198.51.100.20:31330',
    channel: 'chrome',
    // 本地练习保持有头模式，方便观察浏览器；
    // 设 PW_HEADLESS=1（或 CI 环境）时自动转无头，便于无人值守/批量回归
    headless: process.env.CI ? true : process.env.PW_HEADLESS === '1',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    // 失败时自动保留截图、视频和 Trace，用于排查定位器、时序和产品问题
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      // projects：按浏览器或设备分别组织测试
      name: 'chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

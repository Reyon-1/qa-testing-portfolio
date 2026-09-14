/**
 * 模型模块侦察脚本（一次性工具，不参与测试）：
 * 逐个打开 4 个模型子页面，抓取真实 DOM 结构与接口调用。
 * 目的：让后续用例的定位器和接口断言基于事实，而不是猜测。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://198.51.100.20:31330';
const AUTH = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');
const SESSION = path.join(__dirname, '..', 'playwright', '.auth', 'session.json');

const PAGES = [
  { name: '模型提供商', route: '/models/vendors' },
  { name: '模型管理', route: '/models/catalog' },
  { name: '模型上架', route: '/models/offerings' },
  { name: '路由管理', route: '/models/routing' },
];

async function dumpPage(page, name, route) {
  console.log('\n' + '='.repeat(70));
  console.log(`【${name}】 ${route}`);
  console.log('='.repeat(70));

  // 记录本页发出的接口请求
  const apiCalls = [];
  const onRequest = (req) => {
    if (req.url().includes('/api/')) {
      apiCalls.push(`${req.method()} ${req.url().replace(BASE, '')}`);
    }
  };
  page.on('request', onRequest);

  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  console.log('实际 URL:', page.url());

  // 页面标题/主干标题
  const headings = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .map((e) => (e.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 15)
  );
  console.log('标题:', JSON.stringify(headings));

  // 按钮文案
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 40)
  );
  console.log('按钮:', JSON.stringify([...new Set(buttons)]));

  // 表格列头
  const tableHeads = await page.evaluate(() =>
    Array.from(document.querySelectorAll('th')).map((e) => (e.textContent || '').trim())
  );
  console.log('表头:', JSON.stringify(tableHeads));

  // 表格行数 + 首行文本样例
  const rowInfo = await page.evaluate(() => {
    const rows = document.querySelectorAll('tbody tr');
    const first = rows[0]
      ? Array.from(rows[0].querySelectorAll('td')).map((td) =>
          (td.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)
        )
      : [];
    return { count: rows.length, first };
  });
  console.log('表格行数:', rowInfo.count);
  console.log('首行样例:', JSON.stringify(rowInfo.first));

  // 输入框
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,textarea,select')).map((e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.getAttribute('type') || '',
      placeholder: e.getAttribute('placeholder') || '',
      name: e.getAttribute('name') || '',
      ariaLabel: e.getAttribute('aria-label') || '',
      id: e.id || '',
    })).slice(0, 30)
  );
  console.log('输入控件:', JSON.stringify(inputs, null, 1));

  // 分页/tabs 等文案
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"],[role="radio"],.el-radio-button'))
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20)
  );
  if (tabs.length) console.log('Tabs/单选:', JSON.stringify([...new Set(tabs)]));

  console.log('--- 本页接口调用 ---');
  console.log([...new Set(apiCalls)].join('\n'));

  page.off('request', onRequest);
}

async function main() {
  const session = JSON.parse(fs.readFileSync(SESSION, 'utf-8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    storageState: AUTH,
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  await context.addInitScript((saved) => {
    for (const [k, v] of Object.entries(saved)) window.sessionStorage.setItem(k, v);
    window.localStorage.setItem('aiops-admin:locale', 'zh-CN');
  }, session);

  const page = await context.newPage();

  for (const p of PAGES) {
    try {
      await dumpPage(page, p.name, p.route);
    } catch (e) {
      console.log(`【${p.name}】抓取失败:`, e.message);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error('侦察失败:', e);
  process.exit(1);
});

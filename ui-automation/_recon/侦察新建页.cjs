/**
 * 新建页侦察：点击各页"新建"按钮，记录跳转后的真实路由，并 dump 表单字段。
 * 结论用于：写操作用例的 goto 目标与字段断言。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://198.51.100.20:31330';
const AUTH = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');
const SESSION = path.join(__dirname, '..', 'playwright', '.auth', 'session.json');

const TARGETS = [
  { route: '/models/vendors', button: '新建提供商', label: '模型提供商' },
  { route: '/models/offerings', button: '新建上架', label: '模型上架' },
  { route: '/models/routing', button: '新建路由', label: '路由管理' },
];

async function dumpForm(page, label) {
  console.log('\n' + '='.repeat(70));
  console.log(`【${label}】新建页  URL=${page.url()}`);
  console.log('='.repeat(70));

  const fields = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.el-form-item').forEach((item) => {
      const labelEl = item.querySelector('.el-form-item__label');
      const label = labelEl ? (labelEl.textContent || '').trim() : '(无label)';
      const required = labelEl ? labelEl.classList.contains('is-required') : false;
      const control = item.querySelector('input,textarea,select');
      const isSelect = !!item.querySelector('.el-select');
      const isRadio = !!item.querySelector('.el-radio-group');
      const isUpload = !!item.querySelector('.el-upload');
      out.push({
        label,
        required,
        type: isSelect ? 'select' : isRadio ? 'radio' : isUpload ? 'upload'
          : control ? (control.tagName === 'TEXTAREA' ? 'textarea' : control.getAttribute('type') || 'text')
          : 'unknown',
        placeholder: control ? control.getAttribute('placeholder') || '' : '',
      });
    });
    return out;
  });
  console.log('表单字段:');
  fields.forEach((f) => {
    console.log(`  - ${f.label}${f.required ? ' *' : ''} [${f.type}]${f.placeholder ? ' ph=' + f.placeholder : ''}`);
  });

  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );
  console.log('按钮:', JSON.stringify([...new Set(buttons)]));

  const headings = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .map((e) => (e.textContent || '').trim()).filter(Boolean)
  );
  console.log('标题:', JSON.stringify(headings));
}

async function main() {
  const session = JSON.parse(fs.readFileSync(SESSION, 'utf-8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    storageState: AUTH, baseURL: BASE,
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
  });
  await context.addInitScript((saved) => {
    for (const [k, v] of Object.entries(saved)) window.sessionStorage.setItem(k, v);
    window.localStorage.setItem('aiops-admin:locale', 'zh-CN');
  }, session);

  const page = await context.newPage();

  for (const t of TARGETS) {
    try {
      await page.goto(t.route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);

      const calls = [];
      const onReq = (r) => { if (r.url().includes('/api/')) calls.push(`${r.method()} ${r.url().replace(BASE, '')}`); };
      page.on('request', onReq);

      const btn = page.getByRole('button', { name: t.button, exact: true }).first();
      await btn.click();
      await page.waitForTimeout(3500);
      await dumpForm(page, t.label);
      console.log('新建页接口:', JSON.stringify([...new Set(calls)].slice(-8), null, 1));

      page.off('request', onReq);
    } catch (e) {
      console.log(`【${t.label}】失败:`, e.message);
    }
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

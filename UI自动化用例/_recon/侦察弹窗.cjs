/**
 * 弹窗侦察脚本（一次性工具）：
 * 打开各页"新建"弹窗，抓取表单字段、必填标记、按钮，然后关闭（不提交任何数据）。
 * 用途：让写操作用例的定位器和断言基于真实 DOM。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://198.51.100.20:31330';
const AUTH = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');
const SESSION = path.join(__dirname, '..', 'playwright', '.auth', 'session.json');

const TARGETS = [
  { route: '/models/vendors', button: '新建提供商', label: '模型提供商-新建' },
  { route: '/models/offerings', button: '新建上架', label: '模型上架-新建' },
  { route: '/models/routing', button: '新建路由', label: '路由管理-新建' },
];

async function inspectDialog(page, label) {
  console.log('\n' + '='.repeat(70));
  console.log(`【${label}】弹窗结构`);
  console.log('='.repeat(70));

  await page.waitForTimeout(1500);

  // 弹窗容器（Element Plus 用 role=dialog）
  const dialog = page.locator('[role="dialog"], .el-dialog, .el-drawer').first();
  const visible = await dialog.isVisible().catch(() => false);
  if (!visible) {
    console.log('!! 未检测到可见弹窗');
    return;
  }

  const title = await dialog
    .locator('.el-dialog__title, .el-drawer__title, [class*="title"]')
    .first()
    .textContent()
    .catch(() => '');
  console.log('弹窗标题:', (title || '').trim());

  // 表单字段：label + 控件类型 + placeholder + 是否必填
  const fields = await dialog.evaluate((root) => {
    const out = [];
    root.querySelectorAll('.el-form-item').forEach((item) => {
      const labelEl = item.querySelector('.el-form-item__label');
      const label = labelEl ? (labelEl.textContent || '').trim() : '';
      const required = !!item.querySelector('.is-required')
        || (labelEl && labelEl.classList.contains('is-required'));
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
    console.log(`  - ${f.label}${f.required ? ' *必填' : ''} [${f.type}] ${f.placeholder ? 'placeholder=' + f.placeholder : ''}`);
  });

  // 弹窗内按钮
  const btns = await dialog.evaluate((root) =>
    Array.from(root.querySelectorAll('button'))
      .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );
  console.log('弹窗按钮:', JSON.stringify([...new Set(btns)]));

  // 关闭弹窗，不留副作用
  const cancel = dialog.locator('button', { hasText: /取\s*消|关\s*闭/ }).first();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(1000);
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

  for (const t of TARGETS) {
    try {
      await page.goto(t.route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);

      // 用 getByRole 精确匹配按钮名，避免匹配到表格内的同名按钮
      const btn = page.getByRole('button', { name: t.button, exact: true }).first();
      if (!(await btn.isVisible().catch(() => false))) {
        console.log(`\n【${t.label}】找不到按钮: ${t.button}`);
        continue;
      }
      await btn.click();
      await inspectDialog(page, t.label);
    } catch (e) {
      console.log(`【${t.label}】失败:`, e.message);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});

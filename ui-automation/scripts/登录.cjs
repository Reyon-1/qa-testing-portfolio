/**
 * 用 API 完成管理端登录，并生成 Playwright 可复用的登录态文件。
 *
 * 原理（来自对既有登录态文件的分析）：
 *   - Cookie  Authorization            = <tokenValue>
 *   - sessionStorage aiops-admin:auth-token      = "Bearer <tokenValue>"
 *   - sessionStorage aiops-admin:auth-token-name = "Authorization"
 *   - sessionStorage aiops-admin:auth-user-id / auth-role-id
 *
 * 用法：node 登录.cjs <验证码答案>
 */
const fs = require('fs');
const path = require('path');

// 账号密码从环境变量读取，不写进代码，避免凭证进入版本库
// 运行前设置：$env:TEST_USERNAME='...' ; $env:TEST_PASSWORD='...'
const BASE = process.env.TEST_BASE_URL || 'http://198.51.100.20:31330';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || '';

const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth');
const USER_JSON = path.join(AUTH_DIR, 'user.json');
const SESSION_JSON = path.join(AUTH_DIR, 'session.json');
const KEY_FILE = path.join(__dirname, 'captcha_key.txt');

(async () => {
  const answer = process.argv[2];
  if (!answer) {
    console.error('用法: node 登录.cjs <验证码答案>');
    process.exit(1);
  }
  const captchaKey = fs.readFileSync(KEY_FILE, 'utf-8').trim();

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
      captchaKey,
      captchaCode: String(answer),
      rememberMe: true,
    }),
  });
  const body = await res.json();

  if (body.code !== 200) {
    console.error('登录失败:', JSON.stringify(body));
    process.exit(2);
  }

  const data = body.data || {};

  // 关键：接口返回的 tokenValue 自带 "Bearer " 前缀。
  // 而已验证的存储格式要求 Cookie 存裸 token、sessionStorage 存 "Bearer <裸token>"。
  // 因此必须先剥掉前缀，再按各自格式写入，否则会得到 "Bearer Bearer xxx" 而登录态失效。
  const tokenValue = String(data.tokenValue).replace(/^Bearer\s+/i, '');
  const tokenName = data.tokenName || 'Authorization';

  // 打印响应字段结构，便于确认 user-id / role-id 取哪个字段（不打印敏感值）
  console.log('登录成功，data 字段:', Object.keys(data).join(', '));

  const userInfo = data.userInfo || {};
  console.log('userInfo 字段:', Object.keys(userInfo).join(', '));

  // menuList 是服务端下发的真实菜单树，用于确认模块路由，比抓 DOM 可靠
  fs.writeFileSync(
    path.join(__dirname, 'menu.json'),
    JSON.stringify(data.menuList || [], null, 2),
    'utf-8'
  );
  console.log('菜单已保存到 scripts/menu.json');

  // 从响应里尽力提取用户 ID 与角色 ID
  const userId = userInfo.id ?? userInfo.userId ?? data.userId;
  const roleId = userInfo.roleId ?? data.roleId;

  console.log('提取到 userId =', userId, ' roleId =', roleId);

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const userState = {
    cookies: [
      {
        name: tokenName,
        value: tokenValue,
        domain: '198.51.100.20',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [
      {
        origin: 'http://198.51.100.20:31330',
        localStorage: [
          { name: 'aiops-admin:locale', value: 'zh-CN' },
          { name: 'aiops-admin:theme-mode', value: 'light' },
        ],
      },
    ],
  };

  const sessionState = {
    'aiops-admin:auth-user-id': String(userId ?? ''),
    'aiops-admin:auth-role-id': String(roleId ?? '1'),
    'aiops-admin:auth-token-name': tokenName,
    'aiops-admin:auth-token': `Bearer ${tokenValue}`,
  };

  fs.writeFileSync(USER_JSON, JSON.stringify(userState, null, 2), 'utf-8');
  fs.writeFileSync(SESSION_JSON, JSON.stringify(sessionState, null, 2), 'utf-8');

  console.log('已写入:', USER_JSON);
  console.log('已写入:', SESSION_JSON);
})();

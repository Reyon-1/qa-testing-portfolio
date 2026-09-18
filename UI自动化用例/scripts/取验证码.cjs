/**
 * 第一步：向管理端索取一张验证码图片并存盘。
 * 目的：验证码是动态算术题，需要人工/视觉识别后再回填登录。
 */
const fs = require('fs');
const path = require('path');

const BASE = 'http://198.51.100.20:31330';
const OUT_PNG = path.join(__dirname, 'captcha.png');
const OUT_KEY = path.join(__dirname, 'captcha_key.txt');

(async () => {
  const res = await fetch(`${BASE}/api/captcha/get`);
  const body = await res.json();
  if (body.code !== 200) {
    console.error('获取验证码失败:', JSON.stringify(body));
    process.exit(1);
  }
  const { captchaKey, captchaImage } = body.data;
  const base64 = captchaImage.split(',', 2)[1];
  fs.writeFileSync(OUT_PNG, Buffer.from(base64, 'base64'));
  fs.writeFileSync(OUT_KEY, captchaKey, 'utf-8');
  console.log('captchaKey =', captchaKey);
  console.log('图片已保存 =', OUT_PNG);
})();

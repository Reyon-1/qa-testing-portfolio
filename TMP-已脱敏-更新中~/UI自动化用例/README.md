# 管理端 UI 自动化测试

基于 **TypeScript + Playwright Test** 的 Web 管理端 UI 回归测试，
覆盖登录、运营概览、模型管理三大模块，共 **47 条用例**。

| 模块 | 用例数 | 覆盖内容 |
|---|---:|---|
| 登录 | 3 | 页面结构核对、人工验证码登录、登录态持久化 |
| 概览 | 21 | 统计卡、周期卡、图表渲染、时间/租户筛选、空数据与异常 |
| 模型 | 23 | 提供商 / 模型管理 / 模型上架 / 路由管理 的列表、搜索、重置、新建入口 |

---

## 一、技术要点

**Page Object 模式**
页面定位细节封装在 `模型测试辅助.ts` 的 `ModelListPage` 等类里，
用例只描述业务步骤，不重复写选择器。

**Web-first 断言，不用固定 sleep**
统一用 `expect(...).toBeVisible()` / `toHaveCount(0)` 等待页面到达最终状态。
例如等加载遮罩消失，是断言所有可见遮罩数量归零，而不是 `waitForTimeout(3000)`。

**接口层断言，不只看界面**
`接口监听.ts` 记录页面真实发出的请求，用例会断言：
- 首屏确实调用了列表接口（`POST /api/vendor/page`）
- 搜索关键词确实进了请求体
- 字典接口被调用后才渲染「来源」「计费方式」列

只看「表格有没有出来」会漏掉前端假数据、缓存旧结果这类问题。

**登录态双层持久化**
被测系统把 token 存在两处，缺一不可：

| 位置 | 键 | 值 |
|---|---|---|
| Cookie | `Authorization` | 裸 token |
| sessionStorage | `aiops-admin:auth-token` | `Bearer <裸token>` |

`storageState` 只能保存 Cookie 和 localStorage，
sessionStorage 必须用 `page.addInitScript` 在页面脚本执行前注入。
`登录状态.ts` 同时处理这两层。

**Canvas 图表渲染验证**
ECharts 把坐标画在 Canvas 上，DOM 里取不到文本。
概览用例改用 `getImageData()` 读取像素，确认画布确实有绘制内容，
而不是只断言"canvas 元素存在"。

**失败自动留证**
配置了 `trace` + `video` + `screenshot` 均为 `retain-on-failure`，
失败后可以 `npx playwright show-trace` 逐步回放当时页面状态。

---

## 二、目录结构

```
ui-automation/
├─ playwright.config.ts          # 浏览器、超时、报告、产物配置
├─ tests/
│  ├─ 登录状态.ts                 # storageState + sessionStorage 保存/恢复
│  ├─ 接口监听.ts                 # 请求记录、接口等待（跨模块复用）
│  ├─ 登录/
│  │  ├─ 登录测试辅助.ts
│  │  ├─ 登录页信息核对.spec.ts
│  │  ├─ 系统登录.spec.ts          # 人工输入验证码并保存登录态
│  │  └─ 登录后首页访问.spec.ts
│  ├─ 概览/
│  │  ├─ 概览fixtures.ts
│  │  ├─ 概览测试辅助.ts
│  │  └─ *.spec.ts                # 结构 / 筛选 / 图表 / 异常 等 7 个文件
│  └─ 模型/
│     ├─ README.md                # 模型模块详细说明（路由、接口、表头实测值）
│     ├─ 模型fixtures.ts
│     ├─ 模型测试辅助.ts
│     └─ *.spec.ts                # 4 个子模块各一个文件
├─ scripts/
│  ├─ 取验证码.cjs                # 拉取验证码图片
│  └─ 登录.cjs                    # API 登录并生成登录态文件
└─ _recon/                        # 侦察脚本：写用例前先抓真实 DOM，不靠猜
```

---

## 三、运行方式

```powershell
npm install
npx playwright install chromium

# 配置被测环境（不要把真实地址写进代码）
$env:BASE_URL     = 'http://127.0.0.1:31330'
$env:TEST_USERNAME = 'admin'
$env:TEST_PASSWORD = '<你的密码>'

# 准备登录态（动态验证码需人工完成一次）
npm run auth

# 跑全部用例
npm test

# 只跑某模块
npm run test:model
npm run test:overview

# 无头批量跑（快很多）
$env:PW_HEADLESS='1'; npm test

# 查看报告
npx playwright show-report
```

`playwright.config.ts` 的 `headless` 默认关闭（方便观察浏览器），
设 `PW_HEADLESS=1` 或 `CI` 环境变量后自动转无头。

---

## 四、调试经验

**先侦察，再写定位器。**
`_recon/` 下的脚本用于在写用例前抓取真实路由、表头、表单字段和接口调用。
凭猜测写 `getByRole('button', { name: '新建' })` 很容易失败——
这个项目就实测出「新建」按钮点击后**跳转独立路由**而不是弹窗。

**断言失败先分类，不要直接放宽断言。**
按顺序排查：定位器 → 等待时序 → 测试数据 → 环境 → 产品缺陷。
本项目实测曾遇到分页控件**没有**「共 N 条」文案（只有页码按钮），
正确处理是改断言，而不是删掉这条用例。

**登录接口的 token 前缀坑。**
接口返回的 `tokenValue` 自带 `Bearer ` 前缀，
直接拼接会在 sessionStorage 里变成 `Bearer Bearer xxx`，
表现为页面反复跳回登录页。`scripts/登录.cjs` 已做归一化。

---

## 五、脱敏与合规说明

本仓库为**个人测试作品**，内容均已脱敏，不含任何真实业务数据与凭证。

- 被测系统的地址、账号、密码已全部改为占位符或环境变量，
  代码中**不再包含任何真实凭证**。
- 系统名称、接口路径、前端路由、权限标识已统一泛化为一套中性命名
  （例如存储前缀 `aiops-admin:`、接口 `/api/vendor/page`、路由 `/models/vendors`）。
  泛化是**全仓库一致**的，代码内部逻辑仍然自洽，可直接 `tsc` 通过。
- 页面上的中文文案（如「模型提供商」「新建上架」）属于通用业务词汇，未做改写，
  以保证用例的可读性与可迁移性。
- `.gitignore` 已排除 `playwright/.auth/`（登录态）、
  `test-results/`、`playwright-report/`，避免凭证与产物进入版本库。

---

## 六、已知限制

- 登录依赖**动态图片验证码**，无法无人值守全自动，需人工完成一次登录态播种
- 未接入 CI；登录态约 7 天过期，过期后需重新执行 `npm run auth`
- 模型模块目前只做**读操作**（列表、搜索、重置），未覆盖新建/编辑/删除等写操作，
  以避免在共享测试环境产生脏数据

# 模型模块 UI 自动化测试

管理端地址：`http://198.51.100.20:31330`

本目录覆盖「模型」菜单下的 4 个子模块，定位为**基础层 UI 回归**：
验证页面结构、列表数据、搜索/重置、字典加载和新建入口跳转。

---

## 一、覆盖范围

| 子模块 | 路由 | 权限标识 | 用例文件 | 条数 |
|---|---|---|---|---|
| 模型提供商 | `/models/vendors` | `console-model-vendors` | `模型提供商页面结构与查询.spec.ts` | 7 |
| 模型管理 | `/models/catalog` | `console-model-catalog` | `模型管理页面结构与筛选.spec.ts` | 5 |
| 模型上架 | `/models/offerings` | `console-offering-management` | `模型上架页面结构与查询.spec.ts` | 6 |
| 路由管理 | `/models/routing` | `console-system-routing` | `路由管理页面结构与查询.spec.ts` | 5 |

合计 **23 条用例**。

每个列表页覆盖：页面结构与表头 → 首屏接口调用 → 搜索空结果 → 重置恢复。
有新建入口的页面额外覆盖「点击新建跳转到新建页」。

---

## 二、目录结构

```
tests/
├─ 接口监听.ts                 # 跨模块复用：记录请求、等待指定接口返回
├─ 登录状态.ts                 # 既有：storageState + sessionStorage 保存/恢复
└─ 模型/
   ├─ README.md               # 本文件
   ├─ 模型fixtures.ts          # authedPage fixture
   ├─ 模型测试辅助.ts          # 路由常量、4 个列表页配置、ModelListPage、表单辅助
   ├─ 模型提供商页面结构与查询.spec.ts
   ├─ 模型管理页面结构与筛选.spec.ts
   ├─ 模型上架页面结构与查询.spec.ts
   └─ 路由管理页面结构与查询.spec.ts

scripts/
├─ 取验证码.cjs                # 拉取验证码图片 + captchaKey（登录态刷新第一步）
├─ 登录.cjs                    # API 登录并直接生成 Playwright 登录态文件
└─ menu.json                   # 服务端下发的真实菜单树（路由的权威来源）

_recon/                       # 一次性侦察脚本与实测结果，仅作溯源，可删
```

---

## 三、怎么跑

```powershell
# 只跑模型模块（有头，方便观察）
npm run test:model

# 无头批量跑（推荐，快很多）
$env:PW_HEADLESS='1'; npm run test:model

# 只看用例清单，不执行
npx playwright test tests/模型 --list

# 查看 HTML 报告
npx playwright show-report
```

`playwright.config.ts` 里的 `headless` 已改为：默认有头；
设 `PW_HEADLESS=1` 或 `CI` 环境变量时自动无头。你本地观察的习惯不受影响。

---

## 四、登录态维护

模型页依赖登录态，登录态失效时用例会全部失败。
这个系统把登录态存在两处，**必须同时具备**：

| 位置 | 键 | 值 |
|---|---|---|
| Cookie | `Authorization` | 裸 token |
| sessionStorage | `aiops-admin:auth-token` | `Bearer <裸token>` |
| sessionStorage | `aiops-admin:auth-user-id` | 用户 ID |
| sessionStorage | `aiops-admin:auth-role-id` | 角色 ID |

### 方式 A：浏览器手工登录（原有方式）

```powershell
npm run auth
```

浏览器打开后手工输入动态验证码，登录成功的状态会被保存。

### 方式 B：API 登录（脚本化，推荐）

验证码是算术题，需要有人看一眼图片：

```powershell
cd scripts
node 取验证码.cjs          # 生成 scripts/captcha.png 和 captcha_key.txt
# 打开 captcha.png，算出算式结果，例如 "6 × 3 = ?" -> 18
node 登录.cjs 18           # 登录成功并写入 playwright/.auth/*.json
```

**踩坑记录**：登录接口返回的 `tokenValue` 自带 `Bearer ` 前缀。
如果直接拼接，sessionStorage 会变成 `Bearer Bearer xxx`，页面会反复跳回登录页。
`scripts/登录.cjs` 已经做了归一化处理（Cookie 存裸 token，sessionStorage 补一次 `Bearer`）。

---

## 五、已实测确认的页面事实

写用例时**不要凭感觉改定位器**，下面是 2026-09-14 实测结果。

### 「新建」不是弹窗，是独立路由

点击后跳转到新路由，表单在完整页面里：

| 入口 | 跳转路由 |
|---|---|
| 新建提供商 | `/models/vendors/create` |
| 新建上架 | `/models/offerings/create` |
| 新建路由 | `/models/routing/create` |

模型管理页**没有新建入口**，模型随提供商一起创建。

### 各列表页表头

- 模型提供商：提供商名称 / 类型 / 来源 / 状态 / 响应速度 / 最近测试 / 创建日期 / 操作
- 模型管理：模型名称 / 提供商 / 来源 / 状态 / 响应 / 上次测试时间 / 创建时间 / 操作
- 模型上架：模型名称 / 提供商 / 来源 / 模型类型 / 状态 / 计费方式 / 单价 / 排序 / 操作
- 路由管理：路由名称 / 类型 / 模型提供商 / 复杂度层配置 / 状态 / 更新时间 / 操作

### 各列表页接口

| 页面 | 列表接口 | 其他接口 |
|---|---|---|
| 模型提供商 | `POST /api/vendor/page` | `GET /api/vendor/types` |
| 模型管理 | `POST /api/model/page` | `GET /api/dict/list/model_source` |
| 模型上架 | `POST /api/model-offering/page` | `token_price_unit`、`listCurrency`、`POST /api/tenant/page` |
| 路由管理 | `POST /api/model-routing/page` | — |

### 新建页表单字段

- **新建提供商**：提供商名称（必填）、类型、提供商图标、API 地址、添加模式、API 密钥
- **新建上架**：模型类型、提供商、模型名称、RPM、TPM、简介、类型、定价模式、定价信息、输入/输出/写入缓存/读取缓存、租户授权、排序、模型体验
- **新建路由**：路由名称、模型提供商 + 处理模型（复杂度层配置，多组）

### 分页

分页控件是纯页码形式（如 `1 2 3 4 5`），**没有**「共 N 条」文案。
断言总数会失败，要断言页码按钮。

---

## 六、暂未覆盖（后续要做时从这里继续）

本次只做基础层，以下**刻意没做**，避免在测试环境写入真实数据：

1. **写操作全链路**：新建提供商 / 上架 / 路由的提交、校验提示、表格新增行、清理
2. **行内操作**：测试、编辑、上架/下架、禁用及其确认弹窗
3. **模型管理页**：编辑成本配置
4. **异常与边界**：`page.route()` 故障注入、空数据、会话过期、超时
5. **权限**：非超管账号的菜单与按钮可见性
6. **视觉与无障碍**：响应式断点、axe 扫描
7. **CI**：无人值守登录态刷新、报告归档

写写操作用例前务必先确认：**是否有独立测试环境和可清理的测试数据**，
否则会在公司环境留下脏数据。可以参考 `桌面\AI\cleanup_test_residue.py` 的按引用清理思路。

---

## 七、约定

- 所有代码保留**中文注释**，注释说明用到的 Playwright 技术和断言目标
- 断言失败时先判断是**定位器、等待时序、测试数据、环境**还是**产品缺陷**，
  不要为了让用例变绿而放宽断言
- 不用固定 `sleep`，统一用 web-first 断言和接口等待

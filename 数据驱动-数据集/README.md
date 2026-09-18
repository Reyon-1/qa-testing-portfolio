# 数据驱动测试数据（CSV）

用于**接口自动化数据驱动测试**的边界值数据集，覆盖 4 个业务模块，
每个模块分为**正向**与**逆向**两组。

| 模块 | 正向 | 逆向 | 合计 |
|---|---:|---:|---:|
| 用户新增 | 25 | 18 | 43 |
| 供应商新增 | 45 | 189 | 234 |
| 模型新增 | 34 | 138 | 172 |
| 模型上架 | 46 | 330 | 376 |
| **合计** | **150** | **675** | **825 条** |

> 表头不计入条数。825 条数据即 825 组测试输入。

---

## 一、目录结构

```
test-data/
├─ 用户新增-正向边界数据.csv     username,password,realName,phone,email,roleId
├─ 用户新增-逆向边界数据.csv
├─ 供应商新增-正向边界数据.csv   name,type,apiBaseUrl,authMode,apiKeys,healthCheckEndpoint
├─ 供应商新增-逆向边界数据.csv
├─ 模型新增-正向边界数据.csv     providerName,providerType,modelId,displayName,tags
├─ 模型新增-逆向边界数据.csv
├─ 模型上架-正向边界数据.csv     providerName,providerType,modelId,displayName,productCategory,
│                              billingType,prices,modelTpm,modelRpm,description,sortOrder,
│                              experienceEnabled,routeId,tenantIds + r_* 预期值列
└─ 模型上架-逆向边界数据.csv
```

**命名约定**：`<模块>-<正/逆向>边界数据.csv`

- **正向**：预期接口返回成功（`code == 200`）
- **逆向**：预期接口拒绝（`code != 200`），用于验证校验是否生效

---

## 二、测试设计方法

### 边界值分析

每个字段都覆盖**最小值 / 最小-1 / 最大值 / 最大+1**：

| 字段 | 最小值 | 最大+1（应被拒绝） |
|---|---|---|
| username | `x`（1 字符） | 65 字符 |
| password | `p`（1 字符） | 65 字符 |
| realName | `A`（1 字符） | 33 字符 |
| displayName | `x` | 129 字符 |

### 等价类划分

- **合法格式**：`name@sub.example.cn`、`a+b@c.com`、`UPPER@CASE.com`
- **非法格式**：`a@b`、`notanemail`、`a~!@#$%^&*`
- **空值**：空字符串、纯空格

### 安全测试载荷

逆向用例中包含常见注入载荷，验证后端是否做过滤：

| 载荷 | 类型 |
|---|---|
| `' OR '1'='1` | SQL 注入 |
| `<script>alert(1)</script>` | XSS |
| `../../x` | 路径穿越 |

### 特殊字符与国际化

`~!@#$%^&*()`、`a?#&b`、`café`、`emoji😀`、`pv-中文名`、`pv-日本語`、`pv-한국어`

---

## 三、使用方式

数据驱动脚本**逐条读取** CSV，每条数据驱动一次完整业务流程。

**模型上架的调用链**（每条独立执行，跑完即清理）：

```
建 provider  →  建 model  →  调 product/create  →  断言 code  →  清理
```

**模型上架 CSV 的两类列**：

- 前 14 列（`providerName` … `tenantIds`）：用例输入
- 后 4 列（`r_modelTpm`、`r_modelRpm`、`r_tenants`、`r_routeId`）：**预期值**，用于回查校验

---

## 四、实战发现

这批数据驱动测试实际跑出过多个有效缺陷，例如：

- `prices` 字段接受字符串/null 时返回 500 而非 400
- `description` 长度无上限、接受空字符串、XSS/SQL/路径穿越载荷**未过滤**（高危）
- `sortOrder` 接受负数
- `experienceEnabled` 不校验枚举值
- `tenants[].tenantId` **不校验存在性**（高风险）
- `tokenPriceUnit` 不校验枚举、且大小写不敏感
- `modelId` / `displayName` 的渗透载荷在 model 层被正确拦截（模型层防护有效）

---

## 五、脱敏说明

本数据集为**个人测试作品**。

- 所有凭证类字段均为占位值：
  `password` 为 `123456` / `p` / `ppp…`，`apiKeys` 为 `sk-pv01` / `sk-t01` 等。
- 手机号 `1380000000x`、邮箱 `f1@t.com` 均为**构造的测试值**。
- 原数据中的**真实系统 ID（角色 ID、路由 ID）已替换为合成占位 ID**
  （`1000000000000000001` 等），不影响数据驱动逻辑。
- `192.168.1.1`、`10.0.0.1` 是「API 地址」字段的**格式示例**，非真实服务器。
- `https://api.example.com/v1` 为通用占位域名。

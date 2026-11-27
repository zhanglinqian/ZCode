# DeepSeek 账户余额接入（供应商自带余额直查）

2026-11-27 实施。需求是「DeepSeek 也支持查询余额，参照 MiniMax 的供应商自带额度直查」。

**Status:** in-progress（待真实 API Key 实测）

## 结论

DeepSeek 账户余额**不走 ZCode 服务端**，由客户端直连 DeepSeek 官方 `GET /user/balance` 接口读取，
与 MiniMax 的 `GET /v1/token_plan/remains` 同属「供应商自带数据直查」这一类，但**数据语义不同**。

## 一、为什么不能复用 MiniMax 的配额卡

MiniMax 返回的是**配额窗口**（5 小时 / 周窗口），有总额与已用，能推导百分比；
DeepSeek 返回的是**账户余额金额**，只有「总额 / 赠送 / 充值」三个金额，**没有配额上限、没有已用量、没有分母**。

| | MiniMax `token_plan/remains` | DeepSeek `user/balance` |
| --- | --- | --- |
| 语义 | 配额窗口剩余 | 账户余额 |
| 可推导百分比 | 是（`remaining / total`） | 否（无配额上限） |
| 单位 | 次数 | 货币（CNY / USD） |
| 展示形态 | 百分比进度条 | 金额卡片（无进度条） |

强行塞进 `UsageQuotaLimit` 会产生两个错误：

1. `UsageQuotaLimit.percentage` 契约是**已用占比**（`packages/shared/src/usage-quota.ts:32`），
   余额没有「已用」概念，填任何值都是编造；
2. `PlanUsageMetricCard`（`packages/ui/src/settings/model-provider-section/StatusCards.tsx:984`）
   的进度条宽度来自剩余百分比，余额场景下会渲染成一条无意义的 0% 或 100% 进度条。

因此余额走**独立契约** `UsageProviderBalance`，与配额并列挂在同一份 entitlement 快照上，
不新增第二条 RPC 通道、不新增第二份状态。

## 二、数据来源

```
GET https://api.deepseek.com/user/balance
Authorization: Bearer <API Key>
```

响应（官方文档）：

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

- 金额字段是**字符串**，需转 number；`currency` 允许 `CNY` / `USD`。
- `balance_infos` 是**数组**：多币种时逐项展示，不合并成一种货币。
- `is_available` 表示账户是否仍有余额可用于调用；为 false 时展示不可用态而不是空白。

## 三、端点判定

按 **host** 判定，与 MiniMax 同款口径（个人实例可基于任意模板创建，也可能改过端点，host 才是实际会发请求的那台机器）：

- `api.deepseek.com`
- `*.api.deepseek.com`

内置模板 baseUrl 为 `https://api.deepseek.com/anthropic`（`config/provider/zcode-builtin.json:299`），
`new URL("/user/balance", baseUrl)` 会丢弃 `/anthropic` 路径段，最终请求 `https://api.deepseek.com/user/balance`。

注意 DeepSeek 内置模板走的是 **anthropic-messages** 格式（`config/provider/zcode-builtin.json:298`），
与 MiniMax 一样：余额接口在官方根路径上，与模型调用格式无关。

## 四、契约变更

### `packages/shared/src/usage-stats.ts`

```ts
/** 供应商自带账户余额（如 DeepSeek /user/balance）。与 quota（配额窗口）语义不同，不共用 UsageQuotaLimit。 */
export interface UsageProviderBalance {
  /** 币种：CNY / USD。 */
  currency: string;
  /** 账户余额总额。 */
  totalBalance: number;
  /** 赠送余额。 */
  grantedBalance: number;
  /** 充值余额。 */
  toppedUpBalance: number;
}

/** 供应商自带余额快照；余额不可用时为 null。 */
export interface UsageProviderBalanceSnapshot {
  /** 上游是否声明账户仍可用于调用。 */
  available: boolean;
  /** 按币种分列的余额明细；上游可能同时返回 CNY 与 USD。 */
  balances: UsageProviderBalance[];
}
```

`UsageEntitlementSnapshot` 新增可选字段：

```ts
/**
 * 供应商自带账户余额（当前是 DeepSeek 的 /user/balance）。
 * 与 quota 是两条互斥的数据来源：额度是配额窗口百分比，余额是货币金额。
 * 查询失败、未命中供应商端点、或该供应商无余额接口时一律为 null。
 */
providerBalance?: UsageProviderBalanceSnapshot | null;
```

## 五、服务层

| 文件 | 改动 |
| --- | --- |
| `packages/services/src/usage-stats/providers/deepseekBalanceProvider.ts`（新） | `isDeepseekBalanceBaseUrl`（host 判定）、zod schema（金额字符串 → number）、`fetchDeepseekBalance` |
| `packages/services/src/usage-stats/usageStatsService.ts` | 供应商自带数据源分派改为**按端点分派**：MiniMax 命中走配额、DeepSeek 命中走余额；两条命中后都**不回落** GLM 账号型链路 |
| `packages/services/src/node.ts` | `resolveProviderSelfQuotaFacts` 不变（已是端点无关的 API Key + baseUrl 事实） |

### 分派语义

现有分派（`usageStatsService.ts:110-159`）是「命中 MiniMax 端点 → 走 MiniMax；否则回落 GLM」。
新增 DeepSeek 后改为：

```
resolveProviderSelfQuotaFacts(providerId)
  → baseUrl 命中 MiniMax 端点 → fetchMinimaxTokenPlanQuota → quota.limits
  → baseUrl 命中 DeepSeek 端点 → fetchDeepseekBalance      → providerBalance
  → 都没命中                                             → 回落 GLM 账号型链路
```

**命中后绝不回落**是既有约束（2026-11-26 修复过「MiniMax tab 显示的还是 glm 的」）。
DeepSeek 命中后失败同样返回 `unavailable` 快照，不回落 GLM——否则会把 GLM 套餐数据当成 DeepSeek 余额展示。

## 六、UI

### 展示形态

金额卡片，**无进度条**（余额没有分母）。多币种时每币种一张卡。

```text
账户余额

┌─────────────────────────┐
│ ¥110.00                 │
│ 总余额                   │
│ 赠送  ¥10.00            │
│ 充值  ¥100.00           │
└─────────────────────────┘
```

### 入口（三处，与 MiniMax 对称）

1. **模型设置页**：`Detail.tsx` 供应商详情卡标题下的 `afterHeader` 插槽
   （当前 MiniMax 额度区块挂在此处，DeepSeek 余额同处并列）。
2. **使用统计页**：独立 tab，与 MiniMax tab 对称。
3. **聊天输入框 context 面板**（2026-11-27 第二轮新增，MiniMax 用量与 DeepSeek 余额都加）：
   当前选中模型命中供应商自带端点时，在「剩余额度」段位置展示对应面板——
   MiniMax 展示 5 小时/每周 compact 额度条（复用 Coding Plan meter 视觉），
   DeepSeek 展示金额行（无进度条）；「更多」直达使用统计页对应 tab。
   数据在面板打开（hover/click）时经 `useProviderSelfUsageSnapshot` 拉取，
   与设置页共享同一份模块级 30s TTL 缓存；composer 挂载不发起请求
   （遵守 usage-remaining-refresh-policy「只在用户访问时刷新」）。
   与 Coding Plan / Start Plan 面板互斥：由当前连接类型决定展示哪一段
   （`resolveV4ContextPlanConnection` 返回 `kind: "none"` 且端点命中时才挂载本面板）。

### tab 泛化

现有 tab id 是硬编码联合类型 `"app" | "minimax" | "codingPlan" | \`codingPlan:${string}\``
（`packages/ui/src/settings/UsageStatsSection.tsx:8`），且 `SettingsUsageTabTarget`
（`packages/ui/src/lib/settingsNavigation.ts:37`）也硬编码了 `"minimax"`。

新增 DeepSeek tab 后，供应商自带 tab 会出现两个，需要泛化为：

```ts
export type UsageStatsSectionTab = "app" | "codingPlan" | `codingPlan:${string}` | `providerSelfQuota:${string}`;
```

`providerSelfQuota:${providerId}` 用 providerId 区分，MiniMax 与 DeepSeek 各占一个 tab，
且能同时存在多个同类供应商实例。旧的 `"minimax"` 字面量保留为兼容别名（`SettingsUsageTabTarget`
的历史 intent 值可能仍是 `"minimax"`），解析时映射到对应的 `providerSelfQuota:` tab。

### 复用与新增组件

- 新增 `packages/ui/src/settings/model-provider-section/ProviderSelfBalanceSection.tsx`：
  余额区块 + 金额卡片渲染（不复用 `PlanUsageMetricCard`，其百分比进度条语义不适用）。
- `ProviderSelfQuotaSection.tsx` 的 `useProviderSelfQuotaSnapshot` 查询 hook（TTL + in-flight 去重）
  抽到共享模块 `providerSelfUsageSnapshot.ts`，两个区块共用，避免两份平行缓存。

## 七、i18n

5 个 locale（zh-CN / en-US / ja-JP / ko-KR / ru-RU）新增：

| key | zh-CN |
| --- | --- |
| `settings.modelProvider.selfBalance.title` | 账户余额 |
| `settings.modelProvider.selfBalance.total` | 总余额 |
| `settings.modelProvider.selfBalance.granted` | 赠送 |
| `settings.modelProvider.selfBalance.toppedUp` | 充值 |
| `settings.modelProvider.selfBalance.unavailable` | 无法读取账户余额。请确认 API Key 有效。 |

## 八、非目标

- 不改 provider 家族体系（`ProviderFamilyDomain` 保持 zai / bigmodel；DeepSeek 仍是 api-key 型自定义供应商）。
- 不加 `account:` 型 provider、不加 OAuth。
- 不改内置配置基线（DeepSeek 模板已存在）。
- 不做「余额查询失败时回退到别的数据源」的兜底。
- 不给余额加百分比进度条或「赠送占比」推导条（余额没有官方分母，推导比例是编造口径）。
- 不新增 App 业务单测（App 单测已退役，见 `docs/testing/unit-test-quality.md`）；验证走 typecheck / lint / 架构检查与浏览器验收。

## 九、验证记录（2026-11-27）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `tsc -b`（rpc/provider/provider-node/shared/services/client/server/zcode-server-cli/ui + desktop host） | 通过，0 error |
| Lint | `oxlint`（全仓） | 0 error；本次新增/修改的 12 个文件单独扫描 0 warning（`Detail.tsx` 与 `SettingsPage.tsx` 的告警均在未改动的既有行） |
| 架构检查 | `architecture-check.mjs check --changed` | 0 violation（登记 `deepseek-provider-balance-new-files` 例外后） |
| 服务层分派自验证 | 12 项断言 | 12/12 通过：DeepSeek 走余额链路；MiniMax 配额链路未被破坏（80% 剩余 → 20% 已用）；两者命中后均不回落 GLM 账号型链路 |
| 余额映射自验证 | 22 项断言 | 22/22 通过：`baseUrl` 带 `/anthropic` 时 URL 落到 `https://api.deepseek.com/user/balance`；字符串金额转 number；多币种逐项返回；HTTP 401 与未知结构降级为 null；缺币种条目不补 0 |
| 浏览器验收 | `provider-settings-batch.test.mjs`（`CHROME_EXECUTABLE_PATH` 指向系统 Chrome） | 新增 3 个 DeepSeek 用例全部通过；既有 3 个 MiniMax 配额用例全部通过 |

**环境说明**：Playwright 自带的 Chromium 未安装（`chromium_headless_shell` 缺失），需用 `CHROME_EXECUTABLE_PATH` 指向系统 Chrome 才能跑浏览器验收。同批次中 `provider batch` / `offpeak` 等**既有**用例存在 `page.goto` 15s 超时抖动（孤立运行时通过），与本改动无关。

**未执行**：真实 DeepSeek API Key 的接口实测（缺 Key），因此第十节的字段口径仍待实测校准。

### 第二轮验证记录（2026-11-27，聊天 context 面板接入）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `tsc -b`（全 10 个 project） | 通过，0 error |
| Lint | `oxlint`（全仓） | 0 error、538 warnings 与基线持平；新建 3 个文件 0 warning，`contextUsage.tsx` 与 HEAD 基线持平（6 个既有），新增 useMemo 依赖完整 |
| 架构检查 | `architecture-check.mjs check --changed` | 0 violation（例外条目已扩至 7 个新文件） |
| 浏览器验收 | 新增 `provider-self-context-usage.test.mjs`（3 用例） | 3/3 通过：MiniMax 配额 meter（80% 剩余反转正确、5h 卡展示时分、周卡展示日期、「更多」可点）；DeepSeek 金额行（¥110.00、¥10.00 · ¥100.00、无进度条无百分比）；上游失败展示「无法读取套餐额度」文案 |
| 既有回归 | `provider-settings-batch.test.mjs` 相关 5 用例 | 4/5 通过；`MiniMax quota 1200/dark` 因 vite 冷编译 >30s 打穿既有用例的 `page.goto` 默认超时（孤立运行同样失败，属该 fixture 既有冷启动脆弱性，非本轮回归） |

**实现要点**（第二轮）：

- 数据不在 composer 挂载时请求：面板打开（hover/click）时经 `useProviderSelfUsageSnapshot` 拉取，与设置页共享同一份模块级 30s TTL 缓存。
- 与 Coding Plan / Start Plan 互斥：`resolveV4ContextPlanConnection` 返回 `kind: "none"` 且当前 provider 端点命中 + 已填 Key 时才挂载本段。
- MiniMax 复用 Coding Plan 的 compact meter（`ChatCodingPlanUsageMeter` 已导出共用）；DeepSeek 金额行无进度条，金额格式化抽为 `selfBalanceFormat.ts` 供设置页与面板共用。
- 「更多」经 `runContextPanelActionWithClose` 先收面板再直达使用统计页的 `providerSelfQuota:<providerId>` tab。

## 十、待实测校准

1. 真实响应是否为文档所述结构（`balance_infos` 数组 + 字符串金额）；实测后校准 zod schema。
2. `is_available: false` 的实际响应形态（余额为 0 还是接口报错）。
3. HTTP 错误码与响应体（官方文档未给出错误格式）。

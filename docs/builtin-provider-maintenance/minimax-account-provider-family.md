# MiniMax 套餐额度接入（供应商自带额度直查）

2026-11-26 实施。需求是「套餐用量当前只支持 GLM，参照 GLM 增加 MiniMax」。

**Status:** in-progress（待真实订阅 Key 实测）

## 结论

MiniMax 套餐额度**不走 ZCode 服务端**，由客户端直连 MiniMax 官方 `token_plan/remains` 接口读取。
因此不需要账号型 provider、不需要 OAuth、不扩 provider family 体系，也不依赖 ZCode 服务端任何改动。

## 一、为什么不是「做成第三个账号家族」

调研期曾考虑把 MiniMax 做成与 Z.ai / BigModel 对称的账号型家族（`account:minimax-start-plan`），
已用运行时与服务端实测排除：

| 位置 | revision | `account:` 型 provider |
|---|---|---|
| 仓库基线 `config/provider/zcode-builtin.json` | 44 | zai / bigmodel 两族共 10 个 |
| 服务端下发 `zcode-builtin-production-4135.json` | 48 | zai / bigmodel 两族共 10 个 |
| 本机生效缓存 `~/.zcode/v2/runtime/provider/darwin-aarch64/4.0.0/…/zcode-builtin.json` | 48 | zai / bigmodel 两族共 10 个 |

- 服务端 `GET /api/v1/client/configs` 的 `builtinProviders` 只有 5 项，`startPlanPreview.entitlements` 只有 GLM-5.3 / GLM-5.3-Flash，**没有 MiniMax**。
- 内置配置由服务端下发覆盖仓库基线（`zcode-builtin-download.ts` → `applyRemoteRelease`），仓库里加账号型 provider 会被覆盖。
- `access.accountType` 在运行时**就是可登录家族**：要与 `settings.providerFamilyDomain` 与家族连接选择表对照（`accountProviderConnectionResolver.ts`），扩三族会波及十余处 `{ zai?, bigmodel? }` 形状的查表，并在服务端就绪前产出点不动的登录入口。
- Start Plan 凭据是 ZCode JWT，取 JWT 的两条路径都要求该家族具备 OAuth 通道（`oauthCredentialRepo.startPlanMaterialFromSnapshot`）。

## 二、实现

### 数据来源

```
GET {MiniMax baseUrl}/v1/token_plan/remains
Authorization: Bearer <订阅 Key>
Content-Type: application/json
```

- 国内站 `https://api.minimaxi.com`、国际站 `https://api.minimax.io`。
- **订阅 Key 与按量计费 API Key 是两套，互不通用**（MiniMax 官方 FAQ）。用按量 Key 调本接口会被上游拒绝。
- 额度模型是「5 小时窗口 + 周窗口」双窗口独立刷新，与现有 Coding Plan 额度卡的两张卡对应。
- **口径坑**：MiniMax 的 `usage_percent` / `usagePercent` 是**剩余**占比，ZCode 的 `UsageQuotaLimit.percentage` 契约是**已用**占比（展示端再反转成剩余）。映射时必须反转一次。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/services/src/usage-stats/providers/minimaxQuotaProvider.ts`（新） | 端点常量、`isMinimaxQuotaBaseUrl`（按 host 判定）、zod schema（snake_case / camelCase 双接受）、`buildWindowLimit`（百分比反转 + 次数优先）、`fetchMinimaxTokenPlanQuota` |
| `packages/services/src/usage-stats/usageStatsService.ts` | 新增 `ProviderSelfQuotaFacts` 与 `resolveProviderSelfQuotaFacts` 依赖；`getEntitlementSnapshot` 先尝试供应商自带额度，命中则直接返回，否则落回 `quotaProvider.getSnapshotForRequest` |
| `packages/services/src/node.ts` | 注入 `resolveProviderSelfQuotaFacts`：从 `providerRuntime.registryService` 读该 provider 的 `config.access.apiKey` 与 `config.api.baseUrl`，账号型 provider 直接返回 null |
| `packages/ui/src/settings/model-provider-section/ProviderSelfQuotaSection.tsx`（新） | 额度区块：`isProviderSelfQuotaBaseUrl` 判定端点是否支持，支持才发请求；`useUsageEntitlement({ preferredProviderId, requirePreferredProvider: true })` 取快照；按 `unit` 取 5 小时（3）与周（6）两条额度，用 `PlanUsageMetricCard` 渲染；查询失败时展示「需订阅 Key」提示 |
| `packages/ui/src/settings/model-provider-section/StatusCards.tsx` | 仅把 `PlanUsageMetricCard` 改为导出，供第二条额度来源复用同一套卡片渲染 |
| `packages/ui/src/settings/model-provider-section/Detail.tsx` | API Key 型 provider 详情分支上方挂载 `ProviderSelfQuotaSection` |
| `packages/ui/src/i18n/locales/*.ts`（5 个） | 新增 `settings.modelProvider.selfQuota.unavailable` |
| `architecture-policy.yaml` | 为两个新文件登记 `unmanaged-new-file` 例外（沿既有 usage-stats / model-provider-section 边界，不接管整个 services/ui 未受管模块） |

### 额度桶映射

| MiniMax 窗口 | ZCode `UsageQuotaLimit` |
|---|---|
| 5 小时窗口 | `type: "TOKENS_LIMIT"`, `unit: 3`, `number: 5` |
| 周窗口 | `type: "TOKENS_LIMIT"`, `unit: 6` |

与 `StatusCards.tsx` 里 `findUsageLimit(limits, "TOKENS_LIMIT", 3, 5)` / `(…, 6)` 的口径一致，i18n 文案复用 `settings.usage.entitlementFiveHourUsage`（5 小时剩余）与 `settings.usage.entitlementWeeklyUsage`（每周剩余）。

## 三、非目标

- 不改 provider 家族体系（`ProviderFamilyDomain` 保持 zai / bigmodel）。
- 不加 `account:` 型 provider、不加 OAuth、不改 `access.accountType` 枚举。
- 不改内置配置基线（MiniMax 模板已存在；且服务端下发会覆盖仓库基线）。
- 不改 off-peak / highspeed 的家族表（其 family 参数是窄联合，服务端无 MiniMax 能力）。
- 不做「用按量 Key 时回退到其它数据源」的兜底——那会把错误数据混进额度展示。

## 四、实测校准记录（2026-11-26，真实订阅 Key + 真实接口）

推测字段已按真实响应修正：

1. 端点 `https://api.minimaxi.com/v1/token_plan/remains` + `Authorization: Bearer <订阅 Key>` 实测可用。
2. 响应字段（snake_case）：`model_remains[]` 内含 `model_name`（首条为 `"general"` 套餐共享池条目，官方 FAQ 确认额度跨模型共享）、`current_interval_total_count` / `current_interval_usage_count`（5h 窗口次数）、`current_weekly_total_count` / `current_weekly_usage_count`（周窗口次数）、**`current_interval_remaining_percent` / `current_weekly_remaining_percent`（各窗口独立的剩余占比——不是此前推测的 `usage_percent`）**、`start_time` / `end_time`（5h 窗口，毫秒）、**`weekly_start_time` / `weekly_end_time`（周窗口独立时间字段）**、`remains_time` / `weekly_remains_time`（剩余毫秒数）、`current_interval_status` / `current_weekly_status`（状态枚举，含义未解析，暂不使用）。
3. 映射：5h 卡取 `current_interval_remaining_percent` + `end_time`；周卡取 `current_weekly_remaining_percent` + `weekly_end_time`；百分比反转（MiniMax 剩余 → ZCode 已用）保持不变。
4. 修复实测中暴露的两个缺陷：**(a) 日志截断误杀解析**——曾把截断后的日志文本直接 `JSON.parse`，长响应必报 "Unterminated string in JSON"；已改为解析原文、截断副本只进日志（日志上限放宽到 4KB）。**(b) 未登录门槛**——`ProviderSelfQuotaSection` 原先走 `useUsageEntitlement`，其 signed-out 门槛让未登录 ZCode 的实例查不了 MiniMax；已改为组件内直调 usage-stats RPC（MiniMax 凭订阅 Key 直查，本就不依赖平台登录）。
5. UI 查询加 30s TTL + 请求去重：设置页 store 更新引发组件频繁重渲染时，effect 反复触发会对上游每秒发多次请求（实测日志）。
6. 端到端自验证：用真实 Key 调用生产函数 `fetchMinimaxTokenPlanQuota`，返回正确的双窗口 `UsageQuotaLimit`（5h 已用 100% 待重置 / 周已用 0%，重置时间与窗口字段一致）。

## 验证记录

2026-11-26：

- `pnpm typecheck`：通过（全 workspace project references 无错误）。
- `pnpm lint`：0 error。全仓 539 warnings 为既有；本次新增/修改的三个源文件（`minimaxQuotaProvider.ts`、`ProviderSelfQuotaSection.tsx`、`usageStatsService.ts`）单独扫描 0 warning 0 error。
- `pnpm architecture:check --changed`：0 violation（基线 0，新增 0）。
- `pnpm test:architecture`：61 项全部通过。
- 未执行：真实订阅 Key 的接口实测（缺 Key），未启动桌面端 UI 验证。

2026-11-26 用户实测发现并修复两个缺陷（均已重新打包安装）：

1. **GLM 回落 bug**：分派层在 MiniMax 请求失败时落回 GLM 额度链路，导致「MiniMax tab 显示的还是 glm 的」。修复：判定为 MiniMax 端点后绝不回落，失败返回 unavailable 快照（`usageStatsService.ts`）。
2. **登录门槛 bug**：Fenjue 隔离实例未登录 ZCode 时 `useUsageEntitlement` 的 signed-out 门槛禁用了全部额度查询（日志：`getEntitlementSnapshot` 调用数 0）。修复：`ProviderSelfQuotaSection` 改为组件内直调 usage-stats RPC，不再走带登录门槛的共享 hook——MiniMax 凭订阅 Key 直查，本就不依赖平台登录。用户报的「全部报错」实为 App Usage tab 的 `no_active_workspace`（全新实例没开 workspace 的既有行为，与本功能无关）。
3. `minimaxQuotaProvider` 增加响应体日志（截断 512 字符），用于下一步按真实响应校准字段。
4. 待验证：真实订阅 Key 下的字段/端点匹配（校准命令见上文）。

## 已知限制

- 只有订阅 Key 能查到套餐额度；按量计费 Key 会得到上游拒绝，UI 展示「需订阅 Key」提示。
- 额度单位是「次数」而非 token，卡片标签沿用「5 小时剩余 / 每周剩余」，不显示具体次数单位（`PlanUsageMetricCard` 展示剩余百分比）。
- 额度不会结转，5 小时与周窗口各自独立刷新；卡片的重置时间取接口 `end_time`。

# Provider 体系说明

> 范围：模型提供商的抽象、配置、解析、远端内置数据、模型选项映射与实际调用位置。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。

## 分层

```
packages/provider          领域层：ProviderRegistry / Provider / ProviderModel 抽象与配置解析（零 IO 依赖）
packages/provider-node     Node 实现：builtin 配置下载同步缓存、个人配置持久化
apps/zcode-cli/.../adapters/src/model   实际模型调用（AI SDK：@ai-sdk/anthropic / openai / openai-compatible, ai 6.x）
packages/model-option-map  受限 CEL 表达式引擎：按模型选项动态改写请求体
packages/services/src/model-provider    客户端侧 provider 配置运行时与旧配置迁移
```

## packages/provider（领域层）

- `src/registry.ts` — `ProviderRegistry` / `ProviderRegistryView`。
- `src/resolver.ts` — `Provider` / `ProviderModel` 接口、分层 resolve 与序列化。
- `src/registry-service.ts`、`src/account-provider-service.ts`。
- `src/config/` — `provider-config.ts`、`model-config.ts`、`provider-data-schema.ts`、`ids.ts`（ProviderId / ProviderTemplateId / ModelId 均为 string）。
- `src/sources.ts`、`src/effective-model-selection.ts`。
- API 形态枚举（`provider-data-schema.ts`）：`anthropic-messages` / `openai-chat-completions` / `openai-responses`。
- 分组：`standard-personal` / `zai-family` / `bigmodel-family`；access 类型 `api-key` 与 `zhipu-coding-plan-api-key`（accountType zai|bigmodel；mode start-plan / individual-coding-plan / team-coding-plan / off-peak）。
- **具体提供商清单不是硬编码**，由远端 "zcode builtin release" 数据驱动（见下）。

## packages/provider-node（Node 实现）

- builtin 远端同步：`zcode-builtin-remote-synchronizer.ts`、`zcode-builtin-download.ts`、`zcode-builtin-provider-config-source.ts`、`zcode-builtin-provider-config-materializer.ts`、`zcode-builtin-release.ts`（含 `RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi"` 退役常量）、`endpoint-scoped-zcode-builtin-source.ts`。
- 个人配置持久化：`personal-provider-config-repository.ts`、`model-selection-config-repository.ts`、`provider-config-file-codec.ts`、`provider-config-runtime.ts`、`provider-registry-runtime.ts`。
- 模型 reasoning 级别改名映射：`legacy-reasoning-level-renames.ts`（kimi-k2.x / deepseek-v4 等模型）。

## 模型选项映射（packages/model-option-map）

零依赖的**受限 CEL（Common Expression Language 子集）表达式引擎 + 模型选项补丁合成器**，被 `@zcode/shared` 依赖（shared 再被所有端消费）：

- 管线：`tokenizer.ts` → `parser.ts`（`parseRestrictedCel`）→ `evaluator.ts` → `compiler.ts`（带缓存的 `compileRestrictedCel` / `compileModelOptionMap`）。
- 入口 `option-maps.ts` 的 `compileModelOptionMaps(specs)`：Model 创建时编译一次；每个请求只绑定本轮冻结的 option value，把 `reasoningLevel`（string）与 `maxOutputTokens`（number）求值成 `NamedJsonMergePatch`，经 `merge-patch.ts` 的 `applyOrderedJsonMergePatches` 按 JSON Merge Patch（RFC 7396）语义依序合并进请求体。
- 表达式语言刻意限制为受限 CEL（只允许 string|number 输入），保证可静态校验、不可执行任意逻辑。

## 实际调用与订阅

- 模型调用（AI SDK runner/stream/failure 处理）：`apps/zcode-cli/packages/adapters/src/model/`（runner.ts、runner-stream.ts、model-execution.ts、failure-*.ts 等）。
- Coding Plan 订阅（支付宝/Stripe/PayPal）：`packages/services/src/coding-plan-subscription/`；BigModel entitlement：`packages/services/src/bigmodel/`；用量统计：`packages/services/src/usage-stats/`。
- 旧配置迁移测试：`packages/services/test/providerConfigMigration.test.ts`。
- 内置配置文件入口：根 `.env.example` 的 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`；`scripts/builtin-provider-config.mjs`。

## 注意

- 不要在客户端硬编码提供商清单——新增提供商走 builtin release 数据或个人配置。
- `builtin:zapi` 已退役，保留常量用于迁移识别，勿再引用其能力。

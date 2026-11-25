# ZCode 协议演进说明（v1 与 v4）

> 范围：zcode-protocol v1（现行）与 v4（草稿）的职责边界、纪律与版本常量。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。

## v1：现行契约中心

**位置**：`packages/shared/src/zcode-protocol/`。**不再是单文件**：主文件 `index.ts`（4716 行，`wc -l`），同目录另有 `trace.ts`（11 行）与 `plugin-host-queries/` 子目录（`contract.ts`、`module.ts`、`CONTRACT.md`，另有 `contract.example.ts`）。

- 文件头注释明确：单文件导出方便 app 与 agent 共享同一份协议契约；导出约 257 个符号。（`index.ts` :25-28 的「剩余 ~257 个导出」注释**仍在源码里但已滞后于实际规模**，引用时按「源码注释」看待，不当作实际导出数。）
- `index.ts` 头部新增三处对外导出：`export * from "../app-control/contract.js"`（:3）、`export { zcodeProtocolTraceSchema, type ZCodeProtocolTrace } from "./trace.js"`（:7）、`export * from "./plugin-host-queries/contract.js"`（:9）。
- 消费者：services 旧栈、CLI bootstrap 旧协议 server、UI 旧投影。
- 用 **zod 4** 定义全部请求/响应/事件 schema：`zcodeProtocolRequestSchema`（:460-468）、`zcodeSessionEventSchema`（:1914-1941）、`zcodeSessionStateSnapshotSchema`（:1462-1481）。
- 版本常量：`ZCODE_PROTOCOL_VERSION = 1`（:140）；`ZCODE_PROTOCOL_V4_WIRE_VERSION = 3`（:142）。两者**均未变**。

**硬规则**（根 AGENTS.md）：Desktop app 通过 stdio 与 Agent 通信；**协议改动必须同步更新 `packages/shared/src/zcode-protocol/index.ts`**，提供严格类型与运行时校验。v4.0.0 起该目录多了 `trace.ts` 与 `plugin-host-queries/`：新契约写在子模块，由 `index.ts` 统一再导出，AGENTS.md 的「同步更新 index.ts」要求不变。

## v1 新增：trace 与插件只读查询

- **trace**：`packages/shared/src/zcode-protocol/trace.ts` 定义 `zcodeProtocolTraceSchema`（strict 对象，`traceId`/`parentId`/`spanId`/`traceparent` 四个字段全部 optional）与类型 `ZCodeProtocolTrace`。v1 侧挂在 topicResourceRelay 请求（`index.ts` :431）、请求（:465）、通知（:474）三处 `trace` 字段上。
- **插件只读查询**（扩展进程 P2）：`packages/shared/src/zcode-protocol/plugin-host-queries/` 定义两条只读命令——`plugins/readUserOptions`（读本插件 user 层有效选项，含敏感值；方法名 `index.ts` :4541）与 `plugins/mentionItems`（输入框 `@` 面板的 MCP 工具候选项；方法名 :4543）。严格 schema、稳定错误码与不变量见该目录 `CONTRACT.md`；模块清单见同目录 `module.ts`。

## v4：数据模型草稿

**位置**：`packages/shared/src/zcode-protocol-v4/`（经 package.json 子路径 `./zcode-protocol-v4` 暴露；barrel `index.ts` 68 行，较 v3.14.3 的 63 行只增 5 行，增量很小）。

barrel 头注释仍是「ZCode Protocol v4 —— 数据模型草稿。」（`index.ts` :1），**未转正**：v4 至今仍是与 v1 并存的草稿模型，不是现行协议。

文件头纪律：**只放 schema 类型 + 纯函数（coalesce/conflation/apply），运行时一律不进本包**。

| 文件族 | 职责 |
| --- | --- |
| `wire.ts` / `wire-codec.ts` / `wire-reassembly.ts` / `wire-assembler.ts` / `wire-binary.ts` | wire 层编解码、分帧重组 |
| `delta.ts` / `coalesce.ts` / `apply.ts` | 增量、合并、应用（快照 + gap repair 的数学基础） |
| `workflow-runs-*.ts` 一族 | workflow runs 状态机 |
| `transport*` / `controller*` / `snapshot*` | 传输、控制器、快照 |
| `context-composition/` / `input-prediction/` / `session-data/` | v4.0.0 新增的三个契约子目录：模型请求各部分的组成投影、手机远控输入预测（ghost hint）、彻底删除数据的载荷 schema；每个目录带 `contract.ts` + `CONTRACT.md` + `module.ts` |
| `create-session-config.ts` / `pluginInstall.ts` / `workflow-command-rejections.ts` / `workflow-runs-actor-session.ts` / `workflow-runs-holes.ts` | v4.0.0 新增文件：createSession 请求覆盖配置、插件安装文案与本地化、动态工作流命令拒绝词表、workflowRuns 归约的 actor `sessionId` 规则、归约的留白分支 |
| `command.ts` / `rows.ts` / `snapshot.ts` / `transport.ts` / `telemetry.ts` | v4.0.0 有变化：`command.ts` 482 → 628 行（+210 / −64，变更 274 行）、`rows.ts` 432 → 548 行（+132 / −16，变更 148 行）、`snapshot.ts` 509 → 598、`transport.ts` 1152 → 1231、`telemetry.ts` 323 → 403（行数取自 v3.14.3 与 v4.0.0 的 `wc -l` 对比） |

**v4.0.0 新增命令**（均在 `command.ts` 的 `commandPayloadSchemas`）：`applyQueueItemsConfig`（:296，把新模型/mode 应用到其他排队项）、`lockQueueItemEdit`（:282，冻结编辑锁）、`releaseQueueItemEdit`（:283，释放编辑锁）、`setHighspeedMetrics`（:259，高速模式指标回写）、`stopSubagent`（:215，停止子代理）。

**payload 扩展**：

- `createSession`（`command.ts` :91）：新增 `sessionId`（Host 预留归属，:93）、`additionalDirectories`（:94）、`cwd`（会话 cwd 与 workspace 不同，即受管 worktree，:99）、`worktreeCreation`（:101）、`permissionScope`（:102）、`dynamicWorkflowMode`（:126）。
- `sendText`（`command.ts` :142）：新增 `source`（结构化来源：插件 UI、交互视图、会话、扩展，:155）、`genUiContext`（:149）。

v4 服务端实现：`apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/`（v4-gateway、sessions-index-projection、cold-session-resume、transcript-hydration、command-inbox 等，见 [../Agent运行时/会话运行时与CommandInbox说明.md](../Agent运行时/会话运行时与CommandInbox说明.md)）。

## 其他协议常量

- Server CLI 控制协议：`packages/zcode-server-cli/src/contracts.ts` 的 `SERVER_CLI_PROTOCOL_VERSION = 1`（lifecycle 状态机、crash budget 的 zod 契约）。
- 远程握手：`packages/shared` 的 `helloMessageSchema`（Hello/HelloAck，见 [../远程工作区/远程连接链路说明.md](../远程工作区/远程连接链路说明.md)）。

## 改协议的检查单

1. v1 改动：主契约改 `packages/shared/src/zcode-protocol/index.ts`；trace 走 `trace.ts`，插件只读查询走 `plugin-host-queries/`，两者都由 `index.ts` 再导出。严格类型 + zod 运行时校验同步。
2. v4 改动：遵守「纯 schema + 纯函数」纪律；wire 版本号变更需评估新旧端兼容。
3. 涉及 stream / snapshot / queue / 重连：同时验证 desktop-continuous 与 web-remote-replayable 两种语义（见 [../远程工作区/双链路语义说明.md](../远程工作区/双链路语义说明.md)）。

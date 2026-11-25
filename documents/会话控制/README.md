# 会话控制（session-control / app-control）

> 范围：会话控制业务核心（`packages/session-control`）与宿主侧实现（`packages/services/src/app-control`、协议 `packages/shared/src/app-control`）。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。

## 阅读顺序

1. [会话控制核心说明.md](./会话控制核心说明.md) — contract/domain/app 分层、CLI 与 App 双用例、wait 编排、架构边界门禁、测试接入缺口。

## 模块职责

会话控制是**对会话做受控操作**的业务核心：CLI 侧 8 个操作（list / read / create / fork / send / wait / interrupt / rename），App 侧 12 个（多出 listProjects / openSession / setArchived / setPinned）。

核心逻辑放在 `packages/session-control`——**零 IO、零环境依赖**，只依赖 `zod`，因此可脱离进程做完整单测。宿主侧把副作用接上真实服务，放在 `packages/services/src/app-control`。

## 与相邻模块的边界

- **会话与任务**：`packages/services/src/session` 管**任务索引与持久化**（SQLite、automation、off-peak）；本模块管**对会话执行受控操作**。session 模块在 `architecture-policy.yaml` 中是 `managed: false`（legacy），session-control 则是新受管模块。
- **Agent运行时**：CLI 侧 session-control 工具在 `apps/zcode-cli/packages/core/src/tool/session-control/`；Agent 运行时（AgentRuntime / turn 机 / CommandInbox）见 [../Agent运行时/会话运行时与CommandInbox说明.md](../Agent运行时/会话运行时与CommandInbox说明.md)。
- **插件与技能**：扩展宿主（`packages/services/src/extensions`）消费 session-control 的 `/contracts` 子路径暴露会话投影与动作。
- **通信协议**：App 控制面协议类型在 `packages/shared/src/app-control/`（受管模块 `app-control-protocol`）。

## 代码地图

| 路径 | 职责 |
| --- | --- |
| `packages/session-control/src/contract/` | zod schema 与类型：`common.ts`（标识/作用域/可信上下文/授权）、`cli.ts`（8 操作）、`app.ts`（12 操作）、`observation.ts`（操作观察协议）、`results.ts`（公共结果） |
| `packages/session-control/src/domain/` | 纯规则：`operation-outcome.ts`（终态与 wait 判定）、`reference-scope.ts`（作用域与输出复验） |
| `packages/session-control/src/application/` | `common/boundary.ts`（解析/授权/目标解析）、`common/wait.ts`（wait 编排）、`cli/index.ts`、`app/index.ts` |
| `packages/session-control/src/testing/` | 测试替身：`createTestPorts`、`createManualDeadlines`、`createOperationFeed`、`deferred` |
| `packages/session-control/src/module.ts`、`CONTRACT.md` | 架构模块描述与契约自述（指向根 `docs/architecture/zcode-app-control-design.md` §7） |
| `packages/services/src/app-control/` | 宿主侧接线：discovery / execution / observation / context / reverseRpc |
| `packages/shared/src/app-control/` | app-control 协议类型 |

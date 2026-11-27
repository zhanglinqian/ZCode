# 会话与任务

> 范围：任务索引（SQLite）、任务/会话服务、自动化（cron）、闲时任务、Claude 会话导入。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。

## 阅读顺序

1. [任务索引与持久化说明.md](./任务索引与持久化说明.md) — tasksDatabase、taskIndexRepo、数据目录规则、Claude 导入。
2. [自动化与闲时任务说明.md](./自动化与闲时任务说明.md) — automation cron、scheduler 进程派发、off-peak 任务。

## 模块职责

任务/会话的业务状态权威在 `packages/services/src/session`（Host 内 local services 的一部分）；运行时侧的会话执行（AgentRuntime、turn 机、历史注水）在 Agent 运行时模块，见 [../Agent运行时/会话运行时与CommandInbox说明.md](../Agent运行时/会话运行时与CommandInbox说明.md)。

## 与相邻模块的边界

- **桌面应用**：desktop 的 cron scheduler 进程只做轮询与派发，任务事实在 services 的 tasks-index（见自动化说明）。
- **Agent运行时**：会话执行与输入 admission（CommandInbox）归 CLI/runtime；本模块管索引、列表、持久化与调度。
- **架构治理**：`architecture-policy.yaml` 中 session 模块为 legacy（`managed: false`），`publicEntrypoints` 声明的 `packages/services/src/session/contract.ts` 当前不存在（见 [../代码不规范清单.md](../代码不规范清单.md)）。

## 代码地图（packages/services/src/session/）

| 路径 | 职责 |
| --- | --- |
| `tasksDatabase/` | SQLite 任务索引：schema-v1、冻结 checksum 迁移（migrations.ts）、prepared statements、startup、官方 glm 选型（official-glm-selection-v3.ts）、provider 选型（provider-selection-v2.ts） |
| `taskIndexRepo.ts` | sqlite 仓库：tasks / automations / off_peak_tasks 表，可搜索文本截断上限 |
| `zcodeTaskService.ts` | IZCodeTaskService：task 列表/置顶/归档 |
| `automationCron.ts` / `automationRepo.ts` / `automationService.ts` / `automationIntervalCarrier.ts` | 自动化（croner 定时） |
| `offPeakTask(Service/Repo).ts` / `offPeakServerClient.ts` / `offPeakRuntimeModel.ts` / `offPeakMockGateway.ts` | 闲时任务 |
| `claude-native/` | Claude 原生 JSONL 会话解析、导入 repo/service、历史修复 |
| `sessionMailbox.ts` / `sessionRealtimePort.ts` / `sessionTitle.ts` / `taskChangeSummary.ts` / `legacyTaskSessionFile.ts` / `mcpWorkspaceScope.ts` / `sessionModeOptions.ts` | 会话邮箱、实时端口、标题、变更摘要、遗留文件等 |

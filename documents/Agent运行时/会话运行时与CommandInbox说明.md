# 会话运行时与 CommandInbox 说明

> 范围：AgentRuntime、turn 机、会话历史注水、会话存储与恢复、CommandInbox 串行 admission。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。所有路径相对 `apps/zcode-cli/packages/`。

## 运行时核心（core/runtime）

- `core/src/runtime/agent-runtime.ts` — `AgentRuntime`（class，:132 起）：运行时主对象。
- `core/src/runtime/command-queue.ts` — 命令队列。
- `core/src/runtime/execution-state.ts` — 执行状态。
- `core/src/runtime/model-selection.ts` — 运行时模型选择。
- `core/src/runtime/methods/` — 运行时方法集。

## turn 机与历史

- `core/src/agent/turn-machine.ts` — 单轮对话状态机。
- `core/src/agent/session-history-hydrator.ts`、`message-history.ts` — 会话历史注水与消息历史。
- `core/src/session-context/` — 会话上下文构建。
- compact（上下文压缩）：`core/src/compact/`；memory：`core/src/memory/`；context builder：`core/src/context/builder.ts`。

## 会话装配与存储（bootstrap）

- `bootstrap/src/sessions.ts` — 会话列表与恢复（SQLite session store）。
- `bootstrap/src/zcode-protocol-v4/` — v4 协议侧的会话投影与恢复：sessions-index-projection、cold-session-resume（冷会话恢复）、transcript-hydration（转写注水）等。

## CommandInbox（串行 admission，权威顺序）

**位置**：`bootstrap/src/zcode-protocol-v4/command-inbox.ts`（`export class CommandInbox`）。文件注释明确其为「CLI 串行 admission 分配的权威顺序」。

机制：

- per-session FIFO：`AsyncGateRegistry`——session gate 持有到 `settle` 才释放，同 session 命令按实际执行顺序串行 admission。
- key gate：按 key 的互斥。
- 幂等：in-flight pinned / live input / settled LRU（512 条）三层去重。

消费方：

- `bootstrap/src/zcode-protocol-v4/v4-gateway.ts`（:599 `private readonly inbox`）。
- 队列 busy 自动提升：`bootstrap/src/zcode-protocol-v4/queue-auto-drain.ts`。
- queue 命令 handler：`bootstrap/src/zcode-protocol-v4/commands/handlers/queue.ts`。

## 硬规则（根 AGENTS.md）

- 已接受的 busy/running 输入由 CLI/runtime `CommandInbox` 串行 admission；**Renderer 只保留未提交草稿与 pending optimistic overlay**；Host owner/lease 负责路由。
- 保留 owner/lease、跨 Host 路由和 stale run 防护，不能仅根据单一路径删除边界判断。
- 不能用超时掩盖同步问题。

## 状态所有者速查

```
用户输入 → Renderer 草稿（未提交）
        → 提交 → CommandInbox（CLI 侧唯一 admission 权威，FIFO + 幂等）
        → AgentRuntime（执行状态唯一所有者）
        → tasks-index（services 侧投影/持久化，见 ../会话与任务/）
```

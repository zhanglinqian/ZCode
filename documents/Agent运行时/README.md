# Agent 运行时（apps/zcode-cli）

> 范围：Agent CLI、TUI、运行时核心（core/bootstrap/adapters/contracts）、工具与权限、会话运行时与 CommandInbox。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。

## 阅读顺序

1. [子包职责地图.md](./子包职责地图.md) — 18 个子包 + tools 的职责与入口链；第一次接触本模块先读。
2. [工具系统与权限说明.md](./工具系统与权限说明.md) — tool registry/executor、bash 只读判定、PermissionService、hooks trust。
3. [会话运行时与CommandInbox说明.md](./会话运行时与CommandInbox说明.md) — AgentRuntime、turn 机、历史注水、CommandInbox 串行 admission。

## 模块职责

`apps/zcode-cli` 是 Agent CLI 与运行时源码，作为普通目录随仓库克隆（非 submodule）。它既是桌面/服务端拉起的 Agent 子进程的实现（stdio 协议服务端），也独立提供 TUI 与命令行发行包（`zcode` 命令）。

## 与相邻模块的边界

- **桌面应用**：desktop 不直接 spawn Agent，经 `packages/services` 的 zcodeAgentProcessManager 以 stdio 拉起（见 [../桌面应用/进程架构说明.md](../桌面应用/进程架构说明.md)）。
- **通信协议**：CLI 是 zcode-protocol（v1/v4）的服务端实现；协议定义在 `packages/shared`，见 [../通信协议/ZCode协议演进说明.md](../通信协议/ZCode协议演进说明.md)。
- **会话与任务**：任务索引与调度在 services；会话执行状态在本模块。
- **Web端与服务端**：发行包 `zcode --web` 的 Web/TUI 分流见 [../Web端与服务端/Server与守护进程说明.md](../Web端与服务端/Server与守护进程说明.md)。

## 测试现状

`apps/zcode-cli/packages` 内当前**没有任何单测/E2E 测试文件**；质量保障依赖 `turbo run typecheck` + `oxlint`（注意：根 `.oxlintrc.json` 的 ignorePatterns 豁免了整个 `apps/zcode-cli`，lint 由其内部自行运行）与调试工具（`tools/prompt-trajectory`、`scripts/shadow-replay.mjs`）。`apps/zcode-cli/README.md` 中提到的 `tests/` 与 `npm test` 对应旧目录布局，现已不存在（见 [../代码不规范清单.md](../代码不规范清单.md)）。

# 技能与 MCP 说明

> 范围：skills 的扫描/装配/加载、MCP 客户端与官方 MCP、node_repl host。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。
>
> 粒度说明：目录级 + 关键文件锚点；MCP 连接的函数级链路待补（见 [../模块覆盖矩阵.md](../模块覆盖矩阵.md)）。

## 技能（Skills）

三段式：

1. **装配**：`apps/zcode-cli/packages/bootstrap/src/skills.ts` 与 `bootstrap/src/app/bundled-skills.ts`。
2. **扫描适配**：`apps/zcode-cli/packages/adapters/src/skills/`（`roots.ts` 技能根目录解析、`scan.ts` 扫描）。
3. **运行时加载态**：`apps/zcode-cli/packages/core/src/agent/loaded-skills.ts`（会话内技能加载状态）。

配套：

- 契约：`apps/zcode-cli/packages/contracts/src/skills/index.ts`。
- CLI 命令：`apps/zcode-cli/packages/cli/src/skills-command.ts`。
- 锁文件：`apps/zcode-cli/skills-lock.json`（锁定技能资产版本）。
- 桌面侧同步服务：`packages/services/src/skills/`、`skill-sync/`；UI 状态 `packages/ui/src/store/skillStore.ts`、hook `useSkills.ts`。
- 内置技能资产：`apps/zcode-cli/packages/bundled-skills/skills/dynamic-workflows`（无构建步骤，纯资产）。

## MCP（Model Context Protocol）

- **客户端**：`apps/zcode-cli/packages/adapters/src/mcp/` — 连接池（`pool.ts`）、stdio transport（`stdio-transport.ts`）、OAuth（`oauth*.ts`、`official-auth.ts`）、网络（`network.ts`）、Windows job object（`windows-job-object.ts`）与进程树清理（`process-tree.ts`）。
- **配置**：`apps/zcode-cli/packages/bootstrap/src/mcp-config.ts`；子代理侧 `core/src/subagent/mcp-config.ts`、`borrowed-mcp-port.ts`（子代理借用 MCP 端口）。
- **core 侧**：`core/src/mcp/name.ts`、`image-normalization.ts`。
- **workspace 作用域**：`packages/services/src/session/mcpWorkspaceScope.ts`。
- **桌面同步**：`packages/services/src/mcp-sync/`；官方 MCP 凭证 `packages/services/src/official-mcp/officialMcpCredentials.ts`；UI 状态 `packages/ui/src/store/mcpStore.ts` 系列（+Desktop/Helpers/Migration/StatusList）。

## 内置 MCP server：node_repl

`apps/zcode-cli/packages/node-repl-host/src/server.ts` — 共享 node_repl MCP host：JS 执行面 + Browser Use / Computer Use domain bridges（browser-bridge / cua-bridge / runtime-bridge）。配套浏览器自动化契约在 `packages/shared/src/browser-use/`（commands/result/快照/nodeReplBroker）。

## 官方内置 Browser Use 插件

`apps/zcode-cli/packages/browser-use-plugin/`：skills + client runtime，经插件机制分发（见 [插件生命周期说明.md](./插件生命周期说明.md) 的内置插件渠道）。CUA（Computer Use）当前为 fail-closed 占位实现（`packages/zcode-cua`，见 [../Agent运行时/子包职责地图.md](../Agent运行时/子包职责地图.md)）。

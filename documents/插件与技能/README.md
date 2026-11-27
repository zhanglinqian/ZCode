# 插件与技能

> 范围：插件商店与插件生命周期、技能（skills）发现与同步、MCP（Model Context Protocol）接入。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。

## 阅读顺序

1. [插件生命周期说明.md](./插件生命周期说明.md) — 商店结构、安装/启停/更新/卸载/恢复的产品规则与代码位置。
2. [技能与MCP说明.md](./技能与MCP说明.md) — skills 扫描与加载、MCP 客户端池、官方 MCP、node_repl host。

## 术语权威

插件商店领域词汇统一以仓库根 [CONTEXT.md](../../CONTEXT.md) 为准（Official Marketplace / Builtin Plugin / CDN Plugin / Personal Source / Public·Personal Segment / Featured / Installed Strip / Manage Installed View / Store Listing / Plugin Manifest / Example Prompt / Plugin Lifecycle / Restorable Builtin / Orphaned Installed Plugin）。本模块文档引用这些术语时不再重复定义，以 CONTEXT.md 的 Avoid 列表约束用词。

## 与相邻模块的边界

- **Agent运行时**：skills 的运行时加载态（`core/src/agent/loaded-skills.ts`）与 MCP 客户端实现（`apps/zcode-cli/packages/adapters/src/mcp/`）在 Agent 运行时侧；本模块管产品层的服务、同步与 UI。
- **模型与提供商**：MCP 的 OAuth 凭证与 Provider 凭证体系相互独立（MCP OAuth 在 adapters/mcp，Provider 凭证在 provider-node/services）。

## 代码地图

| 路径 | 职责 |
| --- | --- |
| `packages/services/src/plugins/` | 插件域服务 |
| `packages/services/src/plugin-sync/` | 插件同步 |
| `packages/services/src/skills/`、`skill-sync/` | 技能发现与同步 |
| `packages/services/src/official-mcp/`（`officialMcpCredentials.ts`） | 官方 MCP 凭证 |
| `packages/services/src/mcp-sync/` | MCP 配置同步 |
| `packages/ui/src/store/pluginStore.ts`、`pluginManagementStore*`、`skillStore.ts`、`mcpStore.ts` 系列、`subagentsStore.ts`、`commandsStore.ts`、`hooksStore.ts` | 插件/技能/MCP/子代理/命令/hooks 的 UI 状态 |
| `packages/ui/src/hooks/usePlugins.ts`、`useSkills.ts` | UI 服务访问入口 |
| `apps/zcode-cli/packages/browser-use-plugin/` | 官方内置 Browser Use 插件（skills + client runtime） |
| `apps/zcode-cli/packages/bundled-skills/` | 内置技能资产（当前仅 `skills/dynamic-workflows`） |
| `apps/zcode-cli/skills-lock.json` | 技能锁文件 |

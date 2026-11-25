# 技能与 MCP 说明

> 范围：skills 的扫描/装配/加载、MCP 客户端与官方 MCP、node_repl host。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。
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
- **技能开关写入语义（v4.0.0 修正）**：`packages/services/src/skills/skillsService.ts` 的 `writeSkillEnabledMap()` 从「读全量 config.json 再整文件 `writeFile` 写回」改为 `updateJsonObjectFile()`（`packages/services/src/fs/atomicFileUtils.ts`）：写前重读、**只改 `skills` 字段**、原子替换；**文件损坏时报错不写**。旧实现读失败或 JSON 损坏时会退化成空对象再整文件写回，把 config.json 里的 MCP、插件等其他配置一并冲掉。
- 内置技能资产：`apps/zcode-cli/packages/bundled-skills/skills/dynamic-workflows`（无构建步骤，纯资产）。

### 数据同步新域（packages/services/src/data-sync/）

v4.0.0 起各分类的同步统一到同一形状 `IDataSyncCategoryService`（`data-sync/contract.ts`；`index.ts` 只导出契约，`node.ts` 导出实现，`module.ts` 是 architecture-governance 受管模块清单）。原 plugin-sync 主体迁入此域：

- `inlinePluginDataSync.ts`（inline 插件，键 `name@inline` 小写）、`skillDataSync.ts`（技能）、`mcpDataSync.ts`（MCP，导出/导入需按目标端改写路径）。
- `subagentDataSync.ts`、`commandDataSync.ts`、`hookDataSync.ts` 共用 `user-config-sync` 通道，由 `userConfigSyncService.ts` 按 `category` 分派（未知 category 直接报错）。
- `deviceSyncStateService.ts`：本机 Host 的设备同步状态（`IDeviceSyncStateService`，按 sourceServerId 记录）。
- `packages/services/src/plugin-sync/pluginSyncService.ts` 净减 464 行，只保留 marketplace 来源镜像的导出 / 导入 / 预检；`IPluginSyncService` 改为继承 `IDataSyncCategoryService<PluginDataSyncPayload>`。技能与 MCP 通道同样改为复用此域实现：`ISkillSyncService = IDataSyncCategoryService<SkillDataSyncPayload>`（由 `createSkillDataSyncMethods` 组合）、`IMcpSyncService extends IDataSyncCategoryService<McpDataSyncPayload>`（由 `createMcpDataSyncMethods` 组合）。

## MCP（Model Context Protocol）

- **客户端**：`apps/zcode-cli/packages/adapters/src/mcp/` — 连接池（`pool.ts`）、stdio transport（`stdio-transport.ts`）、OAuth（`oauth*.ts`、`official-auth.ts`）、网络（`network.ts`）、Windows job object（`windows-job-object.ts`）与进程树清理（`process-tree.ts`）。v4.0.0 新增六个文件：
  - `config-loader.ts` — MCP 配置加载器：合并配置文件、插件 MCP server 与显式 server，产出 `McpConfigurationSnapshot`（带诊断信息）。
  - `config-source.ts` — MCP 配置来源分层：进程内共享 watcher 与去抖读盘（`createMcpConfigSourceRegistry` / `createDynamicMcpConfigSource`），输入相同的会话共用一组 watcher 与读盘结果，view 释放即回收。
  - `tool-catalog-cache.ts` — 工具目录缓存（`createInMemoryMcpToolCatalog`）：带容量、单条目/总量字节上限与 TTL 的工具目录读缓存。
  - `resource-subscriptions.ts` — 资源订阅登记表（`McpResourceSubscriptionRegistry`，纯内存无 IO）：按 `(serverName, uri)` 登记 subscriberKey，同一连接被多 session 共享时只向 server 订阅一次。
  - `node-fallback.ts` — 桌面 agent 跑在 Electron Node 上、用户机器没装 Node 时，stdio MCP 的 `node` / `npm` / `npx` 回退到 Electron 可执行文件与随包 npm 的 shim。
  - `transport-errors.ts` — 传输错误分类（`classifyTransportError` / `isRetryableCallError`）：区分会话过期、事件流打开失败与其它错误，决定是否重连或重试一次。

  连接池 `pool.ts` 同期扩展了 MCP resources 能力（`readResource` / `listResources` / `listResourceTemplates` / `subscribeResource`）与订阅生命周期管理；`oauth.ts` 大幅扩写（canonical / legacy 凭据兼容、事务化 client 来源、授权码会话与 localhost 回调）。
- **配置**：`apps/zcode-cli/packages/bootstrap/src/mcp-config.ts`；子代理侧 `core/src/subagent/mcp-config.ts`、`borrowed-mcp-port.ts`（子代理借用 MCP 端口）。
- **core 侧**：`core/src/mcp/name.ts`、`image-normalization.ts`。
- **workspace 作用域**：`packages/services/src/session/mcpWorkspaceScope.ts`。
- **桌面同步**：`packages/services/src/mcp-sync/`；官方 MCP 凭证 `packages/services/src/official-mcp/officialMcpCredentials.ts`；UI 状态 `packages/ui/src/store/mcpStore.ts` 系列（+Desktop/Helpers/Migration/StatusList）。

## 内置 MCP server：node_repl

`apps/zcode-cli/packages/node-repl-host/src/server.ts` — 共享 node_repl MCP host：JS 执行面 + Browser Use / Computer Use domain bridges（browser-bridge / cua-bridge / runtime-bridge）。配套浏览器自动化契约在 `packages/shared/src/browser-use/`（commands/result/快照/nodeReplBroker）。

## 官方内置 Browser Use 插件

`apps/zcode-cli/packages/browser-use-plugin/`：skills + client runtime，经插件机制分发（见 [插件生命周期说明.md](./插件生命周期说明.md) 的内置插件渠道）。CUA（Computer Use）当前为 fail-closed 占位实现（`packages/zcode-cua`，见 [../Agent运行时/子包职责地图.md](../Agent运行时/子包职责地图.md)）。

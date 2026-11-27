# Server 与守护进程说明（packages/server + packages/zcode-server-cli）

> 范围：HTTP/WS 服务入口与路由、stdio 模式、token 鉴权、独立 Server CLI 的守护/更新/卸载。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。

## packages/server：两个进程入口

- `src/entry-http.ts`：HTTP 模式。env：`PORT`（默认 3030）、`ZCODE_SERVER_HOST`/`HOST`、`ZCODE_WEB_STATIC_ROOT`、`ZCODE_SERVER_AUTH_TOKEN`；`createLocalServices` 组装服务后调 `createHttpServer`（`src/index.ts` 只导出它）。
- `src/entry-stdio.ts`：stdio 模式（stdout 专用于 RPC 帧，所有 console 输出重定向到 stderr，见文件头注释）；配套 `src/stdio.ts`（`wrapStdio()` 把 stdin/stdout 包成 `ISocket` + `createStdioServer`）、`src/stdioServices.ts`、`src/stdio-lifecycle.ts`、`src/stdioDeviceMid.ts`。

## HTTP 路由清单（src/http.ts，Hono）

| 路由 | 职责 |
| --- | --- |
| `GET /api/server-info` | 返回 `ServerRemoteInfo`（schema 在 `packages/shared/src/server-remote.ts`） |
| `POST /api/rpc-host-capability` | 签发一次性 host capability 令牌 |
| `GET /ws` | 普通 WebSocket，固定 `web-remote-replayable`（terminal-client）模式 |
| `GET /ws/host` | 受信 Desktop host 连接（`desktop-continuous`）；前置 `app.use /ws/host` 校验 `ZCODE_RPC_HOST_CAPABILITY_HEADER`（`hostCapability.ts` 一次性令牌 store，consume 失败 401） |
| `POST /api/connect-remote` | Web 端发起远程连接（`remoteTargetSchema` 校验 → backend → `connectRemote` → Map 存 id） |
| `GET /ws/remote/:id` | 取出 remote connection 桥接给浏览器（一次性，取后即删） |
| `POST /api/bots/:provider(/:botId)` | Bot webhook 回调（校验 `x-zcode-bot-secret`） |
| `GET *`（staticRoot 存在时） | 静态资源 + SPA fallback（`resolveStaticFile`，带目录穿越防护） |

RPC 暴露统一走 `services.exposeOnChannelServer(server, overrides)`；用 `createZCodeAgentConnectionScope` 按 clientMode 区分 `trusted-host-relay` / `terminal-client`；**非 trusted 客户端对 `IProviderProvisioningTargetService` 的 override 直接抛错**（凭据保护）。

## Token 鉴权（http.ts）

- 配置 `authToken`（来自 `ZCODE_SERVER_AUTH_TOKEN`）时，全局中间件保护 `/ws`、`/ws/*`、`/api/*`（`isTokenProtectedPath`；静态资源不要求）。
- 校验 `hasValidLiteToken`（http.ts:219-231）：接受 URL 查询参数 `?token=`，命中后 `Set-Cookie: zcode_lite_token=...; Path=/; HttpOnly; SameSite=Lax`，后续按 cookie 匹配。
- `/ws/host` 另有独立的一次性 capability header 鉴权。
- 命令行版：监听非本机地址默认生成访问令牌（`--token` 指定 / `--no-token` 关闭），见根 README。

## packages/zcode-server-cli：独立 Server 的启动与守护

bin `zcode`（`./dist/server-cli.js`）；**不直接依赖 @zcode/server**——`server-core/http.ts` 是独立的精简 HTTP+WS+RPC host（同用 hono + @zcode/rpc + @zcode/services）。

- 入口：`src/main.ts`（解析 `resolveBundledAgentWiring` 后 `runServerCli`）→ `src/cli.ts` 命令分发（:93-111）：`serve` / `status` / `stop` / `restart` / `update`（含 `apply-update`）/ `uninstall`，其余委托 legacy CLI（`delegateLegacyCli`）。
- `--server-root` 收敛规范布局；`--daemon`/`--supervisor` 控制 daemon 化：优先注册 OS service，失败则 fork detached 子进程（fallback daemon → service 迁移与 data-root 锁冲突处理）。
- **supervisor**（`src/supervisor/supervisor.ts`）：守护进程——生命周期状态机、Core 代际（generation）管理、崩溃退避（`crashBudget.ts`：5 分钟窗口、1s→16s 指数退避）、更新回滚、启动恢复；控制端点 `src/ipc/controlServer.ts`（帧上限 `MAX_CONTROL_FRAME_BYTES`）；状态持久化 `src/runtime/statusSnapshot.ts`。
- **server-core**（`src/server-core/`）：被守护的服务子进程。`entry.ts` 接收 generation 调 `runServerCore`；`core.ts` 组装服务并起 core HTTP/WS（含 loopback 判定、parent-disconnect 自杀、task activity 追踪供更新前判断）。
- **runtime**（`src/runtime/`）：磁盘布局（`paths.ts`）、immutable release 下载安装（`releaseManager.ts`/`releaseInstaller.ts`）、锁（`lock.ts`）、安装归属（`installationOwnership.ts`）、stable launcher、卸载守卫（`uninstallGuard.ts`）、更新命令、启动恢复。
- 平台服务注册：`src/platform/serviceManager.ts`（darwin/linux 与 win32 分支）。
- 契约：`src/contracts.ts`（zod）——`lifecycleStateSchema`（starting/ready/stopping/crashed/crash-loop-stopped/updating/uninstalling…）、`serverStatusSchema`、`crashBudgetSchema`、`SERVER_CLI_PROTOCOL_VERSION = 1`。

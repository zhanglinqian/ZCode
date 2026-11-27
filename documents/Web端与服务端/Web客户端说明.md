# Web 客户端说明（packages/web）

> 范围：Web 客户端的入口路由、与 server 的通信、平台降级。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。

## 定位

`packages/web` 是浏览器端壳：入口 `index.html` → `src/main.tsx`（全部启动/路由编排集中于此），业务 UI 与 desktop renderer 共用 `@zcode/ui`。依赖仅 `@zcode/client`、`@zcode/shared`、`@zcode/ui` + react。

## 路由三分（src/main.tsx）

1. OAuth 回调页：`/share/callback`、`/cn/share/callback` → `src/auth/WebCallbackPage.tsx`。
2. 会话分享页：`/share/*` → `src/share/ConversationShareLandingPage.tsx`（语言跟随路径前缀 `/cn/`）。
3. 正常 Web App：渲染 `@zcode/ui` 的 `Root`。

## 与 server 的通信

- **WebSocket（主通道）**：`connectViaWebSocket`（`packages/client/src/websocket.ts`）——浏览器 WebSocket 包装为 `ISocket` → SocketProtocol → ChannelClient → `remoteServiceAccess.ts` 得到 `IServiceAccessor`。wsUrl：默认 `wss/ws://<host>/ws`；带 `?remote=<id>` 时连 `/ws/remote/<id>`（`resolveWebBootstrap()`）。
- **HTTP（辅助）**：`fetch("/api/server-info")` 获取初始 workspace 路径；分享页用 `ConversationSharePreviewClient`（`src/share/conversationSharePreviewClient.ts`，baseUrl `${VITE_ZCODE_BASE_URL||origin}/api/v1`；dev 可用 `mockConversationSharePreviewClient.ts`）。

开发链路：`pnpm dev:web` 同时起 Web dev server（默认 http://localhost:5173）与后端（默认 http://localhost:3030）；`/ws` 与一般 `/api` 代理到本地后端，`/api/v1/oauth/token` 单独代理到产品服务。可用 `ZCODE_SERVER_WORKSPACE` 指定后端工作区。

## 平台降级（IPlatformService）

`src/main.tsx` 的 `createWebPlatform()` 提供 `IPlatformService`（`packages/shared/src/platform.ts:529`）的 Web 降级实现：

- 无法选目录/文件（`preferDirectoryBrowser`）；
- 远程连接不支持：`connectRemote` 返回失败（"Remote connect is not supported in Web mode yet"）、`allowRemoteWorkspace={false}`；
- 不支持内嵌浏览器（`supportsEmbeddedBrowser={false}`）；
- 系统通知用浏览器 Notification 代替。

## 其他文件

- `src/auth/`：`webAuthService.ts`、`zaiWebOAuthProvider.ts`、`webZaiOAuthConfig.ts`、`oauthStateCodec.ts`、`browserOAuthCredentialRepo.ts`。
- `src/webThemeSeed.ts`：默认 Zai dark（分享页默认浅色）。
- `src/communityUrl.ts`。

## 测试

`packages/web` 当前无任何测试文件（见 [../架构治理与工程化/架构治理说明.md](../架构治理与工程化/架构治理说明.md) 测试现状）。

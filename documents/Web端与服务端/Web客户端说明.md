# Web 客户端说明（packages/web）

> 范围：Web 客户端的入口路由、与 server 的通信、平台降级，以及独立的 Share 落地页链路（`packages/web-share` / `packages/share-ui`）。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。

## 定位

`packages/web` 是浏览器端壳：入口 `index.html` → `src/main.tsx`（全部启动/路由编排集中于此），业务 UI 与 desktop renderer 共用 `@zcode/ui`。依赖仅 `@zcode/client`、`@zcode/shared`、`@zcode/ui` + react。

## 路由多族（src/main.tsx）

`src/main.tsx`（1907 行）集中编排全部启动/路由判定，`bootstrapWebApp()` 按顺序分流：

1. OAuth 回调页：`/share/callback`、`/cn/share/callback`（`isWebOAuthCallback()`，需带 `state` + `code`/`authCode`/`error`），以及 Web 远控 OAuth 回调（`/remote/v4` 带同一组参数，`isWebRemoteControlOAuthCallback()`）→ `src/auth/WebCallbackPage.tsx`。
2. 会话分享页：`/share/*`、`/cn/share/*`（`isConversationSharePath()`）→ `src/share/ConversationShareLandingPage.tsx`（语言跟随路径前缀 `/cn/`）。
3. Web 远控路由族：`/remote/v4` 与 `resolveWebRemoteControlRoutePath(import.meta.env)` 派生的路径（未注入 `VITE_WEB_REMOTE_CONTROL_ROUTE_PATH` 时按 Vite `BASE_URL` 推导，默认 `/remote`；判定用 `matchesWebRemoteControlRoutePath()`，接受尾斜杠）→ `packages/web/src/web-remote-control/`。入口是 `app/webRemoteControlEntry.ts` 的 `WebRemoteControlEntry`，按视图状态分发：callback / login / devices / failure。
4. Web 登录页：`src/auth/WebLoginPage.tsx`（配 `webAuthService`）——它是远控流程里的「未登录」视图状态（`view.kind === "login"`），不是独立 URL 路由。
5. 正常 Web App：渲染 `@zcode/ui` 的 `Root`。

分享管理页（`/share/manage`、`/cn/share/manage`）不在本包入口内，由独立的 Share 应用 `packages/web-share` 承担，源码取自本包 `src/share-manage/`。

## 与 server 的通信

- **WebSocket（主通道）**：`connectViaWebSocket`（`packages/client/src/websocket.ts`）——浏览器 WebSocket 包装为 `ISocket` → SocketProtocol → ChannelClient → `remoteServiceAccess.ts` 得到 `IServiceAccessor`。wsUrl：默认 `wss/ws://<host>/ws`（`resolveWebBootstrap()`）。**服务端已无 `/ws/remote/:id` 路由**（与 `POST /api/connect-remote` 一起下线，见 [Server与守护进程说明.md](./Server与守护进程说明.md)），Web 侧不再有独立远程入口；`packages/web/src/main.tsx:452-460` 仍保留 `?remote=<id>` 分支并拼出 `/ws/remote/<id>`，该分支因服务端路由缺失而不可用。
- **HTTP（辅助）**：`fetch("/api/server-info")` 获取初始 workspace 路径；分享页用 `ConversationSharePreviewClient`（`src/share/conversationSharePreviewClient.ts`，baseUrl `${VITE_ZCODE_BASE_URL||origin}/api/v1`；dev 可用 `mockConversationSharePreviewClient.ts`）。

开发链路：`pnpm dev:web` 同时起 Web dev server（默认 http://localhost:5173）与后端（默认 http://localhost:3030）；`/ws` 与一般 `/api` 代理到本地后端，`/api/v1/oauth/token` 单独代理到产品服务。可用 `ZCODE_SERVER_WORKSPACE` 指定后端工作区。

## 平台降级（IPlatformService）

`packages/web/src/platform/index.ts` 的 `createWebPlatform()` 提供 `IPlatformService`（`packages/shared/src/platform.ts:819`）的 Web 降级实现（v4.0.0 从 `src/main.tsx` 迁出为独立目录 `src/platform/`，含 `contract.ts` / `module.ts` / `saveBrowserFile.ts`）：

- 无法选目录/文件（`preferDirectoryBrowser`）；
- 远程连接不支持：`connectRemote` 返回失败（"Remote connect is not supported in Web mode yet"）、`allowRemoteWorkspace={false}`；
- 不支持内嵌浏览器（`supportsEmbeddedBrowser={false}`）；
- 系统通知用浏览器 Notification 代替。

## 其他文件

- `src/auth/`：`webAuthService.ts`、`zaiWebOAuthProvider.ts`、`webZaiOAuthConfig.ts`、`oauthStateCodec.ts`、`browserOAuthCredentialRepo.ts`；另有 `WebCallbackPage.tsx`、`WebLoginPage.tsx`、`webRegionalOAuth.ts`、`webAuthLocale.ts`。
- `src/platform/`：Web 端 `IPlatformService` 实现（`index.ts` 的 `createWebPlatform()`）。
- `src/web-remote-control/`：Web 远控链路（`app/` 入口与路由、`adapters/` 传输与设备、`domain/`、`ui/` 页面、`contracts/`）；主题种子在 `adapters/webRemoteControlThemeSeed.ts`（原 `src/webThemeSeed.ts` 已删除，分享页默认浅色）。
- `src/share-manage/`：分享管理页（`ConversationShareManagePage.tsx` + `conversationShareManageClient.ts`），供 `packages/web-share` 以相对路径源码引用。
- `src/communityUrl.ts`。

## Share 独立入口（packages/web-share + packages/share-ui）

Share 静态落地页走**独立的 Vite 应用**，不经过完整 Web 的 bootstrap。

| 包 | 职责 |
| --- | --- |
| `packages/web-share` | 应用入口：`src/main.tsx`（189 行）是唯一渲染出口，负责主题同步、路由分发（OAuth callback → `/share/manage` → `/share/<code>` → 错误页）、mock 模式（`VITE_CONVERSATION_SHARE_PREVIEW_MOCK=true`）；另有 `src/ShareAuthPages.tsx` 的 `ShareCallbackPage`。构建 `vite build` → `packages/web-share/dist`，`base` = `/cn/share/`，`publicDir` 复用 `packages/web/public` |
| `packages/share-ui` | 极薄的只读 presentation 层：`src/index.ts` 只有 6 行，重导出 `ConversationShareReadonlyTimeline` 与 `Theme`；`src/styles.css` 补两条 `@source` 登记 `packages/web/src/share/**` 与 `packages/web/src/share-manage/**`（Tailwind 默认只扫 `packages/ui/src`，不登记会让分享管理页顶栏塌成 33px） |

**依赖边界（关键）**：`web-share` **不声明** `@zcode/web` / `@zcode/ui` 依赖，改用**相对路径源码引用**（`../../web/src/share/*`、`../../ui/src/useTheme.js` 等）+ `vite.config.ts` 的 **11 条 `resolve.alias`** 指向源码。目的是让 Share 镜像不安装 `@zcode/web`→`@zcode/client`→`@zcode/ui`→`@zcode/services`→`@zcode/zcode-cua` 这条链。

**准入规则**：新增 `@zcode/*` **值导入**（非 type-only）必须同时登记 vite 别名与部署侧 Dockerfile 的 COPY。`packages/share-ui` 的依赖清单是 `@zcode/ui` 的**裁剪拷贝**（71 → 59 个），新增依赖必须同步裁剪。

**接入现状**：根有 `build:web-share`、`dev:web-share:test` / `dev:web-share:mock`；但两者**都不在根 `pnpm typecheck` 列表**且**包内无 `tsconfig.json`** → 无独立类型检查（靠 Vite 构建 + oxlint）；**无单测**；**未登记**为 `architecture-policy.yaml` 受管模块。部署侧用 `Dockerfile.web-share` + nginx 发布到 `/cn/share` 与 `/share`（该 Dockerfile 不在本仓库）。

**权威文档**：根 `docs/web-share/web-share-build-decoupling.md`（依赖边界图与准入规则）、`docs/web-share/web-share-static-deployment.md`。

## 测试

`packages/web` 的测试分两类：

- **工程测试**：仍只有 `packages/web/test/viteConfigLoad.test.ts` 一个文件（根 `scripts/engineering-test-files.json` 中 web 段唯一 1 条）。App 业务单测已整体退役，Web 端行为改动改用 spec + E2E / 浏览器验收验证（见 [../架构治理与工程化/架构治理说明.md](../架构治理与工程化/架构治理说明.md) 测试现状）。
- **E2E（v4.0.0 新增）**：`packages/web/test/e2e/remote-control/**`（`authentication` / `projects` / `transport` 三个分组，均为 Playwright 脚本，目录层级 `manual-review/pending/`）与 `packages/web/test/e2e/sharing/**`（分享链路的认证 / 内容 / 工作流分组）；另有 `packages/web/test/viteConfigLoad.test.ts`。脚本在文件头注明自启 Vite 与运行命令（如 `pnpm --filter @zcode/web exec vite --host 127.0.0.1 --port 5178 --strictPort`），不进 vitest 工程清单。

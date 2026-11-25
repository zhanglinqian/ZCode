# 桌面应用（packages/desktop）

> 范围：Electron 桌面端的进程架构、窗口/Host 生命周期、构建与打包。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。

## 阅读顺序

1. [进程架构说明.md](./进程架构说明.md) — Main / Host / Scheduler / Preload / Renderer 五类进程的职责与通信链路。改进程边界、窗口逻辑、Host 装配前必读。
2. [构建与打包说明.md](./构建与打包说明.md) — 开发环境分档、运行时资产准备（agent bundle / native search / mock-cdn）、electron-builder 打包链。

## 模块职责

`packages/desktop` 是 Electron 壳：负责窗口、原生操作、进程调度和消息转发，**不承载 task/session 业务状态**（见仓库根 `AGENTS.md`「进程、协议与远程控制」）。业务 UI 来自 `@zcode/ui`，业务服务由 Host 进程内的 `@zcode/services` 提供，Agent 进程由 services 层 spawn（stdio 协议）。

## 与相邻模块的边界

- **会话与任务**：任务/会话状态归 `packages/services/src/session` 与 Host 内 local services；desktop Main 只做转发与进程生命周期上报（`src/main/desktopHostProcess.ts` 消费 `HostResponseTypes.*` 事件）。
- **远程工作区**：SSH/WSL 远程连接的状态机在 Host 的 `src/host/windowRemoteConnectionRegistry.ts`，链路细节见 [../远程工作区/远程连接链路说明.md](../远程工作区/远程连接链路说明.md)。
- **通信协议**：Host↔Renderer、Host↔手机 的通道基于 `@zcode/rpc` 的 MessagePort/Socket 协议，见 [../通信协议/RPC框架分层说明.md](../通信协议/RPC框架分层说明.md)。
- **用户界面**：renderer 内的业务组件全部来自 `@zcode/ui`，desktop 自有 renderer 代码只有启动桥接（`src/renderer/src/main.tsx` 等）。

## 代码地图（顶层）

| 路径（相对 packages/desktop） | 职责 |
| --- | --- |
| `src/main/` | Electron Main：应用生命周期、窗口、托盘、自动更新、IPC、cron scheduler 拉起 |
| `src/host/` | 每窗口一个的 Host UtilityProcess：local services 装配、远程连接注册表、attachment 挂载 |
| `src/preload/` | contextBridge preload（主窗口、资源管理器、CUA 权限浮窗、浏览器录像等） |
| `src/renderer/` | React 渲染层（Vite 多页：`index.html`、`resource-manager.html`、`cua-permission-panel.html`） |
| `src/scheduler/` | 常驻 cron scheduler UtilityProcess（`src/scheduler/index.ts` 头注释） |
| `src/shared/` | main 与 preload/renderer 共享的 ARMS RUM bridge 转发代码 |
| `native/` | macos-window-bounds、windows-browser-import-helper 原生小工具 |
| `build/` | 图标、entitlements、installer.nsh、DMG 背景等打包资源 |
| `scripts/` | 构建脚本（见构建与打包说明） |

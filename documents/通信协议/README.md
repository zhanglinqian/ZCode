# 通信协议

> 范围：RPC 框架（packages/rpc）、ZCode 协议 v1/v4（packages/shared）、Agent 客户端 SDK（packages/client）。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。

## 阅读顺序

1. [RPC框架分层说明.md](./RPC框架分层说明.md) — 传输无关的 IPC/RPC 分层抽象；加服务、接通道前必读。
2. [ZCode协议演进说明.md](./ZCode协议演进说明.md) — zcode-protocol v1 与 v4 草稿的边界、纪律与版本常量。

## 模块职责

三层关系：

```
packages/rpc      通用 RPC 框架（VS Code 风格，传输无关：MessagePort / WebSocket / Socket / stdio）
packages/shared   zcode-protocol v1（现行契约+运行时校验）与 v4（数据模型草稿）+ IPlatformService
packages/client   Agent 客户端 SDK：connectViaWebSocket / connectViaMessagePort / RemoteServiceAccess
```

## 与相邻模块的边界

- **桌面应用 / 远程工作区**：Host↔Renderer（MessagePort）、Host↔手机（WS）、Host↔远端（stdio/WS）都建立在 `IMessagePassingProtocol` 之上；通道建立方式见各自模块文档。
- **Web端与服务端**：server 的 `/ws`、`/ws/host` 是本框架的服务端挂载点（原 `/ws/remote/:id` 已随 Web 侧远程直连入口一起下线）。
- **Agent运行时**：CLI 是 zcode-protocol 的服务端实现（bootstrap 包）。

## 代码地图

| 路径 | 职责 |
| --- | --- |
| `packages/rpc/src/`（扁平 16 文件） | 分层 IPC 框架（见 RPC框架分层说明）；`examples/` 有 basic/proxy/messageport/remote 四个 demo |
| `packages/shared/src/zcode-protocol/index.ts` | v1 协议契约中心（主文件 index.ts 约 4716 行 + trace.ts + plugin-host-queries/，zod 4） |
| `packages/shared/src/zcode-protocol-v4/` | v4 数据模型草稿（wire/delta/coalesce/apply/workflow-runs/transport/controller/snapshot）；新增契约子目录 context-composition/、input-prediction/、session-data/ |
| `packages/shared/src/platform.ts` | IPlatformService：UI 与宿主环境之间的平台操作门面（:529） |
| `packages/client/src/index.ts` | SDK 出口 |
| `packages/client/src/websocket.ts` | `connectViaWebSocket` / `connectViaProtocol` |
| `packages/client/src/messageport.ts` | `connectViaMessagePort` / `createMessagePortServiceConnection` |
| `packages/client/src/remoteServiceAccess.ts` | `RemoteServiceAccess`：40+ 服务代理自动生成 |

# RPC 框架分层说明（packages/rpc）

> 范围：@zcode/rpc 的七层抽象与关键扩展点。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。包自述：VS Code style IPC communication abstraction framework；零运行时依赖；`src/index.ts` 顶部有 ASCII 架构图。

## 七层

| 层 | 文件（packages/rpc/src/） | 关键抽象 |
| --- | --- | --- |
| L0 基础设施 | `foundation.ts`、`buffer.ts` | `IDisposable`/`DisposableStore`、`Event<T>`/`Emitter`（懒订阅：首订阅触发 `onWillAddFirstListener`——ChannelClient「有人监听才发 EventListen」的机制基础）、`Relay`、`EventMultiplexer`、`CancellationToken`；`VSBuffer`（Node/浏览器统一二进制） |
| L1 序列化 | `serialization.ts` | VS Code 风格自定义二进制序列化（1 字节类型标签 + VQL 变长整数）；`serialize`/`deserialize`、`BufferReader`/`BufferWriter` |
| L2 传输协议 | `protocol.ts`、`persistent-protocol.ts` | **框架腰部抽象 `IMessagePassingProtocol`**（`send(VSBuffer)` + `onMessage`）；实现它即可接入 RPC（Electron IPC / MessagePort / WebSocket / Socket 均可）。具体实现 `SocketProtocol`、`MessagePortProtocol`、`ChunkStream`、`ISocket`、`ConnectionFlowControl`；`PersistentProtocol` 提供 ACK、心跳、断线重放有界缓冲、饱和/排空水位 |
| L3 Channel RPC | `channels.shared.ts`、`channelServer.ts`、`channelClient.ts`、`delayedChannel.ts` | `ChannelServer`（注册 `IServerChannel`，含 pending request 缓冲）、`ChannelClient`（`getChannel<T>()` 返回 `IChannel`，call/listen）、`getDelayedChannel` |
| L4 连接管理 | `ipc.ts` | `IPCServer`（1:N，每连接独立 ChannelServer+ChannelClient，`IClientRouter`/`StaticRouter` 路由、`getMulticastEvent` 多播）、`IPCClient`（1:1 双向，首条消息发送 ctx 标识身份） |
| L5 服务代理 | `proxy-channel.ts` | `ProxyChannel.fromService()` 把 service 对象自动包装成 `IServerChannel`；`ProxyChannel.toService<T>()` 用 ES6 Proxy 生成像本地方法一样调用的客户端桩 |
| L6 Remote | `remote.ts` | `RemoteAuthorityResolverService`、`RemoteSocketFactoryService`、`WebSocketRemoteConnection`/`ManagedRemoteConnection`、`RemoteAgentConnection`、URI transformer |

中间件：`logging-middleware.ts`（LoggingChannelServer/Client）、`network-telemetry-middleware.ts`（网络遥测观察）。

## 接入方式速查

- **新增一个 RPC 服务**：服务实现（接口定义在 `@zcode/services`）→ 服务端 `services.exposeOnChannelServer` 或 `ProxyChannel.fromService` 注册 → 客户端经 `RemoteServiceAccess`（`packages/client/src/remoteServiceAccess.ts`）自动获得类型安全代理；文件注释约定「新增服务只需在此添加一个 getter」。
- **新增一种通道**：实现 `IMessagePassingProtocol`（或先实现 `ISocket` 再用 `SocketProtocol` 包装），参考 `packages/client/src/websocket.ts`（浏览器 WS → ISocket）与 `packages/desktop/src/host/electronPort.ts`（MessagePort）。
- **demo**：`packages/rpc/examples/` 的 basic / proxy / messageport / remote。

## 消费方

- Desktop：Host 的 ChannelServer + Renderer 的 `connectViaMessagePort`（`packages/desktop/src/renderer/src/main.tsx`）。
- Web：`connectViaWebSocket`（`packages/client/src/websocket.ts`）。
- Server：`packages/server/src/http.ts` 的 WS 路由挂载（见 [../Web端与服务端/Server与守护进程说明.md](../Web端与服务端/Server与守护进程说明.md)）。
- 远端 agent：stdio 包装成 ISocket（`packages/server/src/remote/stdio-socket.ts`、`packages/server/src/stdio.ts`）。

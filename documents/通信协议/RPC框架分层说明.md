# RPC 框架分层说明（packages/rpc）

> 范围：@zcode/rpc 的七层抽象与关键扩展点。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。包自述：VS Code style IPC communication abstraction framework；零运行时依赖；`src/index.ts` 顶部有 ASCII 架构图。

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

## 层内机制变更（v4.0.0，不改变分层结论）

七层抽象本身没有变化：`packages/rpc/src/` 仍是 16 个文件，`src/index.ts` 顶部 ASCII 图仍是 Layer 0–Layer 6，无新增或重命名层。v4.0.0 的改动都在各层内部机制上：

- **L3 事件订阅失败独立成帧**：`packages/rpc/src/channels.shared.ts` 新增 `ResponseType.EventError = 205`（:31）与对应的 `IRawResponse` 变体（:59-63）。服务端 `channelServer.ts` 在订阅抛错时回该帧（不再把错误对象写进事件流）；客户端 `channelClient.ts` 收到后删除 handler、移除 active request 并 `emitter.dispose()`——即**销毁监听器并结束请求**，错误只落 console，不进入业务事件流。
- **L1 二进制判定改为按 holder 上的原值**：`packages/rpc/src/serialization.ts` 的 `encodeRpcJsonValue` 改为读取 holder 上未被 `toJSON` 展开的原值再判断 `Uint8Array`。旧写法下 `Buffer` 先被展开成 `{type:"Buffer",data:[...]}`、不再进 base64 标记，归档体积约膨胀 3.6 倍（源码注释记录的 bug 根因）。
- **L5 未知方法兼容判定**：`packages/rpc/src/proxy-channel.ts` 新增导出 `isProxyMethodNotFoundError(error, command)`（:224）与 `proxyMethodNotFoundMessage(command)`（:216），用于识别「旧对端不认识新方法」；错误跨 IPC 只保留 message，只能按消息精确匹配。消费方示例：`packages/services/src/window-controller/windowController.ts` :130 对 `previewArchivedTaskDeletions` 的判定。

## 接入方式速查

- **新增一个 RPC 服务**：服务实现（接口定义在 `@zcode/services`）→ 服务端 `services.exposeOnChannelServer` 或 `ProxyChannel.fromService` 注册 → 客户端经 `RemoteServiceAccess`（`packages/client/src/remoteServiceAccess.ts`）自动获得类型安全代理；文件注释约定「新增服务只需在此添加一个 getter」。
- **新增一种通道**：实现 `IMessagePassingProtocol`（或先实现 `ISocket` 再用 `SocketProtocol` 包装），参考 `packages/client/src/websocket.ts`（浏览器 WS → ISocket）与 `packages/desktop/src/host/electronPort.ts`（MessagePort）。
- **demo**：`packages/rpc/examples/` 的 basic / proxy / messageport / remote。`packages/rpc/package.json` 的 `demo:messageport` 已从 `examples/03-ipc-server-client.ts` 改为 `examples/03-messageport-ipc.ts`（:17）；仓库里的示例源文件仍名为 `examples/03-ipc-server-client.ts`，脚本改名未同步落地到文件。

## 消费方

- Desktop：Host 的 ChannelServer + Renderer 的 `connectViaMessagePort`（`packages/desktop/src/renderer/src/main.tsx`）。
- Web：`connectViaWebSocket`（`packages/client/src/websocket.ts`）。
- Server：`packages/server/src/http.ts` 的 WS 路由挂载（见 [../Web端与服务端/Server与守护进程说明.md](../Web端与服务端/Server与守护进程说明.md)）。
- 远端 agent：stdio 包装成 ISocket（`packages/server/src/remote/stdio-socket.ts`、`packages/server/src/stdio.ts`）。

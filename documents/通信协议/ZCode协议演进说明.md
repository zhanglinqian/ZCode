# ZCode 协议演进说明（v1 与 v4）

> 范围：zcode-protocol v1（现行）与 v4（草稿）的职责边界、纪律与版本常量。代码基准：main@29628c9（v3.14.3）；核对日期：2026-10-10。

## v1：现行契约中心

**位置**：`packages/shared/src/zcode-protocol/index.ts`（单文件，约 3720 行）。

- 文件头注释明确：单文件导出方便 app 与 agent 共享同一份协议契约；导出约 257 个符号。
- 消费者：services 旧栈、CLI bootstrap 旧协议 server、UI 旧投影。
- 用 **zod 4** 定义全部请求/响应/事件 schema：`zcodeProtocolRequestSchema`、`zcodeSessionEventSchema`、`zcodeSessionStateSnapshotSchema` 等（约 :286-333、:1016-1035、:1445-1471）。
- 版本常量：`ZCODE_PROTOCOL_VERSION = 1`；`ZCODE_PROTOCOL_V4_WIRE_VERSION = 3`（也定义在本文件 :76）。

**硬规则**（根 AGENTS.md）：Desktop app 通过 stdio 与 Agent 通信；**协议改动必须同步更新 `packages/shared/src/zcode-protocol/index.ts`**，提供严格类型与运行时校验。

## v4：数据模型草稿

**位置**：`packages/shared/src/zcode-protocol-v4/`（经 package.json 子路径 `./zcode-protocol-v4` 暴露；barrel `index.ts` 仅 63 行）。

文件头纪律：**只放 schema 类型 + 纯函数（coalesce/conflation/apply），运行时一律不进本包**。

| 文件族 | 职责 |
| --- | --- |
| `wire.ts` / `wire-codec.ts` / `wire-reassembly.ts` / `wire-assembler.ts` / `wire-binary.ts` | wire 层编解码、分帧重组 |
| `delta.ts` / `coalesce.ts` / `apply.ts` | 增量、合并、应用（快照 + gap repair 的数学基础） |
| `workflow-runs-*.ts` 一族 | workflow runs 状态机 |
| `transport*` / `controller*` / `snapshot*` | 传输、控制器、快照 |

v4 服务端实现：`apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/`（v4-gateway、sessions-index-projection、cold-session-resume、transcript-hydration、command-inbox 等，见 [../Agent运行时/会话运行时与CommandInbox说明.md](../Agent运行时/会话运行时与CommandInbox说明.md)）。

## 其他协议常量

- Server CLI 控制协议：`packages/zcode-server-cli/src/contracts.ts` 的 `SERVER_CLI_PROTOCOL_VERSION = 1`（lifecycle 状态机、crash budget 的 zod 契约）。
- 远程握手：`packages/shared` 的 `helloMessageSchema`（Hello/HelloAck，见 [../远程工作区/远程连接链路说明.md](../远程工作区/远程连接链路说明.md)）。

## 改协议的检查单

1. v1 改动：只改 `packages/shared/src/zcode-protocol/index.ts`，严格类型 + zod 运行时校验同步。
2. v4 改动：遵守「纯 schema + 纯函数」纪律；wire 版本号变更需评估新旧端兼容。
3. 涉及 stream / snapshot / queue / 重连：同时验证 desktop-continuous 与 web-remote-replayable 两种语义（见 [../远程工作区/双链路语义说明.md](../远程工作区/双链路语义说明.md)）。

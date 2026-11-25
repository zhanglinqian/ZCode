# Android 远控客户端说明

> 范围：`packages/android/` 的入口、URL 白名单策略、前台保活、最近链接存储与 Compose UI；以及它与桌面 Host attachment 的关系。代码基准：main@a4b44451（v4.0.0）；核对日期：2026-11-25。

> ⚠ **本目录不在任何自动化工具链内**。它是唯一的独立 Gradle/Kotlin 工程：无 `package.json`（不进 pnpm workspace）、未登记 `architecture-policy.yaml`、无 CI 配置、不在 `electron-builder.config.js`、不在根 `typecheck`/`lint`/`knip` 覆盖范围。**只能手工用 Android Studio 构建**，不参与发行。

## 模块职责

ZCode 手机远控的 **Android 原生壳**：用粘贴 / 扫码 / `zcode://remote` deep link 打开远控链接，用 WebView 承载既有的 `/remote` 手机 Web 远控页面。

**不重写** ZCode 的 Agent、relay 或 RPC 协议——它只是既有 Web 远控页面的原生容器与入口策略层。

## 工程形态

| 项 | 值 |
| --- | --- |
| 构建系统 | Gradle（Kotlin DSL），`settings.gradle.kts` → `rootProject.name = "zcode-android"`、`include(":app")` |
| 版本目录 | `gradle/libs.versions.toml`：AGP 9.2.1、Kotlin 2.2.10、composeBom 2026.02.01、camerax 1.6.0、mlkitBarcode 17.3.0 |
| 应用 ID / namespace | `com.example.zcode_mobile`（applicationId 同名） |
| 代码量 | 约 1261 行 Kotlin（MainActivity 114 + `remote/` 263 + `ui/RemoteControlApp.kt` 764 + `ui/theme/` 97 + 模板测试 23） |
| 文案 | `res/values/strings.xml`（英文）与 `res/values-zh-rCN/strings.xml`（中文，30 条 key 完全对齐） |

## 入口与路由

`MainActivity` 是唯一 Activity，路由来源按优先级：

1. `savedInstanceState`（进程重建恢复）
2. Intent extra
3. Intent data（`zcode://remote` deep link）
4. `EXTRA_TEXT`（从其它应用分享文本）

命中后 `openRemoteUrl()` 做三件事：置 `FLAG_KEEP_SCREEN_ON`、申请 `POST_NOTIFICATIONS` 权限、启动前台保活服务。

## 远控三件套（`app/src/main/java/com/example/zcode_mobile/remote/`）

### URL 白名单策略（`RemoteControlUrlPolicy.kt`）

| 场景 | 允许范围 |
| --- | --- |
| 生产 | 仅 `https://zcode.z.ai/remote` |
| `BuildConfig.DEBUG` | 额外放开 `localhost` / `10.0.2.2` / `*.local` / `192.168.*` / `10.*` / `172.16-31.*` 的 `/remote` 路径 |
| deep link | `zcode://remote` scheme 映射到默认 URL |

对外 API：`resolve(raw: String?)` / `resolve(uri: Uri?)` / `isAllowedRemoteUrl(raw: String?)`。

### 前台保活（`RemoteControlKeepAliveService.kt`）

- `foregroundServiceType="dataSync"`，通知渠道 `zcode_remote_control`。
- `START_NOT_STICKY`：进程被回收后**不自动重启**，由用户重新打开。
- 对外：`start(context, remoteUrl)` / `stop(context)`，常量 `EXTRA_REMOTE_URL`。

### 最近链接（`RemoteControlRecentLinksStore.kt`）

- `SharedPreferences` 存最近 **5** 条；读取时**逐条复验** `RemoteControlUrlPolicy.resolve`（防止历史记录里残留被策略否定的 URL）。
- 对外：`read` / `record` / `clear`，以及 `RemoteControlRecentLink` 数据类、`displayTitle()` / `displaySubtitle()`。

## UI（`ui/RemoteControlApp.kt`，764 行）

Compose 单文件承载全部界面：

| 组件 | 职责 |
| --- | --- |
| `RemoteControlApp` | 入口 composable；参数 `remoteUrl` / `recentLinks` / `onOpenUrl` / `onCloseRemote` / `onClearRecentLinks` |
| `RemoteControlQrScanner` / `RemoteQrCameraPreview` | CameraX 预览 + ML Kit 条码扫描 |
| `RemoteControlLauncher` | 入口选择（粘贴 / 扫码 / 最近链接） |
| `RemoteControlWebViewScreen` | WebView 承载 `/remote` 页面 |
| `RemoteControlTopBar` | 顶栏 |
| `RemoteControlErrorOverlay` | 错误覆盖层（URL 被策略拒绝等） |
| `createRemoteControlWebView` | WebView 工厂 |

主题在 `ui/theme/`：`Color.kt` / `Theme.kt` / `Type.kt`（Material3）。

## 与桌面 Host 的关系

Android 端**不另起 Agent、Local Host 或远程会话**——它打开的是手机 Web 远控页面，页面连接桌面**已有的 Host attachment**，走 `web-remote-replayable` 恢复链路语义。

与 `desktop-continuous` 实时链路必须明确区分（根 `AGENTS.md` 硬规则）：修改 stream / snapshot / queue / 重连时，两种语义要同时验证。详见 [../远程工作区/双链路语义说明.md](../远程工作区/双链路语义说明.md)。

## 已知缺口

| 项 | 说明 |
| --- | --- |
| 测试 | `app/src/androidTest/` 只有 Android Studio 模板生成的 `ExampleInstrumentedTest.kt`（仅断言包名），**无任何业务测试** |
| 静态质量门禁 | 不参与 `pnpm typecheck` / `pnpm lint` / `pnpm knip`，也无 Kotlin lint 配置接入 |
| CI / 发行 | 无 CI 配置；不进 `electron-builder.config.js`；`scripts/` 全目录无 gradle 相关调用；`mise.toml` 无 android 任务 |
| 架构治理 | `architecture-policy.yaml` 中无 `android` 条目，未登记为受控模块 |
| 包名 | 仍是 `com.example.zcode_mobile` 模板名，未改为正式应用 ID |

## 相关文档

- 根 `docs/mobile-remote-control-android.md` — 手机远控 Android 端说明（入口、扫码、后台稳定性边界）。
- 根 `docs/web-remote-control/` — Web 远控控制链路。

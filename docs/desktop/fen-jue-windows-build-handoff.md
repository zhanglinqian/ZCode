# Fen Jue Windows 构建交接

2026-11-27 交接并接续完成 Windows x64 构建、安装和启动验证。已安装到 `D:\Program Files\Fen Jue`；MiniMax 订阅额度卡仍待配置 Key 后验收。

## 一、已完成（macOS 侧，已验证）

| 项         | 状态                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 源码二开   | 第三种构建期身份 `fenjue`：appId `dev.fenjue.app`、应用名 `Fen Jue`、独立 Electron userData、独立业务数据根、Windows AUMID、CUA Helper 安装变体 |
| 双实例隔离 | `~/.zcode/**` 收口到 `shared/node/dataRootPaths.ts`，App 与 CLI 共用同一解析器；默认根按编译期身份决定                                          |
| macOS 产物 | `Fen Jue.app` 完整应用（含 Electron 与内置 Agent），已安装运行，lsof 确认独立数据根、官方实例不受影响、会话库 ready                             |
| 质量门     | typecheck、lint（0 error）、架构检查（0 violation）、工程测试 45/45 通过                                                                        |
| 提交       | 分支 `feature/20261125-fenjue`，已推到 `origin`（zhanglinqian/ZCode）                                                                           |

相关提交：

```
2453d7bc chore: Windows 构建支持覆盖 VS 生成器
2327b7cf fix: MiniMax 额度卡位置与共享池标签
ca1a885d feat: 数据根收口支持双实例并行隔离
ea49dc13 feat: 新增 Fen Jue 独立产品身份
```

## 二、Windows 侧进度（构建与安装已完成）

已确认的阻塞点与处置：

| 项                    | 结论                                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 能否在 macOS 交叉构建 | **不能**。预装工具入口 shim 的 CMakeLists 硬性要求 MSVC（`if(NOT MSVC) FATAL_ERROR`），构建脚本在非 Windows 平台直接跳过；Windows 打包的 afterPack 会硬校验 entry shim、runtime-host、installer-process-helper 三个 exe，缺一即失败 |
| Windows 机器现状      | ROG-9：实际构建使用 Node 24.14.0、pnpm 10.33.2、Python 3.14.3、CMake 4.4.2、Visual Studio 18.11（VS 2026）；没有 VS 2022。系统原 Node 24.12 未替换                                                                                  |
| 已做的适配            | 新增 `ZCODE_WINDOWS_VS_GENERATOR` 环境变量，可把生成器从默认 `Visual Studio 17 2022` 切到 `Visual Studio 18 2026`。覆盖点：runtime-host、entry shim、native-search 三处原生构建；默认值不变，CI 基线不受影响                        |
| 代码就绪情况          | Fen Jue 提交已合入 Windows 主目录 `E:\GitHub\ZCode` 的本地 main；原独立 worktree 已移除，后续直接使用主目录                                                                                                                         |

2026-11-27 接续：已在 ROG-9 的独立 worktree 实际运行构建，VS 2026 成功生成 runtime-host、installer-process-helper、入口 shim 三个 exe；Agent、桌面生产代码和 NSIS 安装器构建通过。安装与启动证据见第七节。

## 三、接手步骤

### 0. 取代码

已有 worktree 时（推荐，不碰主仓库本地改动）：

```powershell
git -C E:\GitHub\ZCode pull --ff-only
```

新机器直接克隆：

```powershell
git clone -b feature/20261125-fenjue git@github.com:zhanglinqian/ZCode.git E:\GitHub\ZCode
```

确认 HEAD 含 `2453d7bc`（生成器覆盖）。

### 1. 前置检查

| 依赖                      | 要求                                        | 检查命令                                                |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| Node.js                   | 24.14.0（以 `mise.toml` 为准）              | `node -v`                                               |
| pnpm                      | 经 corepack 启用                            | `corepack enable; pnpm -v`                              |
| Git                       | 可访问 GitHub                               | `git ls-remote --heads origin`                          |
| Visual Studio Build Tools | 含 C++ 生成工具与 CMake 组件（2022 或更新） | `cmake --help` 能看到对应 `Visual Studio <版本>` 生成器 |
| Python                    | 3.10+（node-gyp 用）                        | `python --version`                                      |

只装了 VS 18 时，构建前设置：

```powershell
$env:ZCODE_WINDOWS_VS_GENERATOR = "Visual Studio 18 2026"
```

装了 VS 2022 则无需设置（默认就是 `Visual Studio 17 2022`）。

### 2. 构建

```powershell
cd E:\GitHub\ZCode
$env:ZCODE_ENV = "production"
$env:ZCODE_FENJUE_IDENTITY = "1"
$env:ZCODE_DESKTOP_DIST_DIR = "dist-fenjue"
# PowerShell 7 启动 Node 后会继承其模块路径；Windows PowerShell 5.1
# 解包子进程必须使用系统模块，避免误加载 PS7 Archive 模块。
$env:PSModulePath = [Environment]::GetEnvironmentVariable("PSModulePath", "Machine")
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
pnpm install --frozen-lockfile
pnpm bundle:desktop -- win x64
```

arm64 机器把末尾参数换成 `win arm64`；本次只实际验证 x64。

本次目标机的专用工具目录为 `%LOCALAPPDATA%\fenjue-build-tools`，其中 Node 为 `node-v24.14.0-win-x64\node.exe`，pnpm shim 通过 `corepack enable --install-directory <专用工具目录>` 建立。新 SSH 会话需把这两个目录加入当前进程的 `PATH`，再检查 `node -v`、`pnpm -v`；未修改机器全局 Node 或 PATH。脚本和日志也保存在该目录。

构建链会自动产出并校验 Windows 专属产物（entry shim、runtime-host、installer-process-helper），无需手工准备。

### 3. 产物

```
packages\desktop\dist-fenjue\Fen Jue-4.0.0-win-x64.exe
```

### 4. 安装到 D:\Program Files

- 运行安装器 → Advanced 页把安装目录改为 `D:\Program Files\Fen Jue`（向导已允许改目录）。
- 构建未签名，SmartScreen 提示后选「仍要运行」；`D:\Program Files` 需要管理员权限时以管理员身份运行安装器。
- 业务数据根是 `%USERPROFILE%\.fen-jue-home\.zcode`（独立，不碰官方 `%USERPROFILE%\.zcode`）；Electron userData 是 `%APPDATA%\Fen Jue`。

## 四、验收清单

- [x] 安装器实际执行成功（退出码 0），安装目录为 `D:\Program Files\Fen Jue`
- [x] 产品元数据和窗口标题为 `Fen Jue`；安装目录、开始菜单和桌面快捷方式使用 Fen Jue 名称。内部兼容文件仍有 `zcode` 名称，不属于全量品牌替换
- [x] 首次启动成功，主窗口正常渲染；主进程日志没有缺模块错误
- [x] 业务数据落在 `%USERPROFILE%\.fen-jue-home\.zcode`，CLI 存储握手到达 ready，无 `startup_status_timeout`
- [x] 官方 ZCode 原有进程继续运行，仍有独立的 `%USERPROFILE%\.zcode\cli\db\db.sqlite`；未停止官方进程或迁移其数据
- [ ] 自动更新入口 UI 专项检查；已核对构建身份为 fenjue，主进程只对 production 身份启用更新，因此不接官方 feed
- [ ] 设置页 MiniMax 额度卡正常（新实例未配置模型/订阅 Key，未执行额度请求）

## 五、已知限制

- **CUA 不可用**：当前源码的 `packages/zcode-cua` 是 `zcodeCuaPlaceholder: true` 占位包，不含真实 Helper runtime；Windows 构建按 producer 检测结果跳过 Helper 准备。恢复需要合法提供真实 producer，并满足 Fen Jue 的签名信任要求；不要通过开发逃生开关绕过。
- **图标沿用上游**，未做 Fen Jue 品牌图形。
- **界面文案**仍有 `ZCode` 字样（窗口标题与系统产品名已是 Fen Jue，但全量替换未做）。
- **VS 2026 的可选原生加速限制**：依赖安装使用的 node-gyp 11.5.0 未识别 VS 2026，`cpu-features` 与 ssh2 可选 crypto binding 构建失败；`pnpm install` 仍成功退出，ssh2 回退 JS 实现。CMake 原生组件使用 `ZCODE_WINDOWS_VS_GENERATOR` 已实际构建成功。此限制不能写成所有原生依赖均编译通过。

## 六、参考

- `docs/desktop/fen-jue-product-identity.md`：产品身份规则、构建命令、边界与验收
- `docs/desktop/zcode-preview-packaging.md`：既有 flavor 机制规范（production / preview）
- `docs/preinstalled-tools/windows-entry-shim.md`：入口 shim 的 MSVC 构建契约
- `packages/shared/src/node/dataRootPaths.ts`：数据根唯一解析器

## 七、2026-11-27 Windows 实机结果

### 交付与验证

- 构建源码：`feb97219`，Windows 构建工作目录 `E:\GitHub\ZCode`。
- 安装器：`E:\GitHub\ZCode\packages\desktop\dist-fenjue\Fen Jue-4.0.0-win-x64.exe`，193.5 MiB，低于 500 MiB 体积门禁。
- SHA256：`41fe197ba7b196d3a09b184de743806ebd32b846d988870b8bd05b4a63eaa88f`。
- 实际静默安装参数：`/S /D=D:\Program Files\Fen Jue`，退出码 0；已安装主程序产品名为 Fen Jue，版本 4.0.0.0。
- 应用包校验：`zcodeProductFlavor=fenjue`、版本 4.0.0；97 项运行依赖闭包存在；原生资源策略 0 violation；三个 Windows exe 均为 x64 PE。安装后的 `app.asar` SHA256 与构建目录中的文件一致。
- 首次启动：在当前交互桌面会话打开专用空白 `smoke-workspace`，窗口标题 Fen Jue，主界面正常渲染。Host `desktop-continuous` 连接 ready，数据库启动终态 ready。
- 内置 CLI：使用安装目录的 Electron Node runtime 执行 `resources\glm\zcode.cjs app-server --stdio --prepare-storage`，收到 `startup/storagePath` 后按协议发送 `startup/storagePathReady`（`reuse=false`）。状态经过 checking、committing、ready，收到 `startup/storagePrepared`，退出码 0、stderr 为空。路径为 `%USERPROFILE%\.fen-jue-home\.zcode\cli\db\db.sqlite`。
- Electron userData 为 `%APPDATA%\Fen Jue`，业务数据根为 `%USERPROFILE%\.fen-jue-home\.zcode`。官方 ZCode 原有进程与独立会话库继续存在。
- 本次 macOS 源码检查：Node 24.14.0 / pnpm 10.33.2 下 `pnpm typecheck` 通过；`pnpm lint` 为 0 error、538 warning；`pnpm architecture:check --changed` 为 0 violation。此次只修改交接文档，没有修改产品代码，也未重跑历史 45 项工程测试。

### 现场问题与恢复依据

1. **PowerShell 模块路径污染**：Node 从 PowerShell 7 继承模块路径后，解压子进程 `powershell.exe` 加载 PS7 Archive 模块，报 `ExtractToDirectory` 重载不匹配。把本次构建进程的 `PSModulePath` 设为系统 Machine 值后，ugrep、ripgrep 解压和校验实际通过；没有修改全局配置。
2. **NSIS 临时安装器一次激活失败**：生成卸载器阶段出现 `spawn EPERM`，直接执行同一文件曾出现 SideBySide XML 解析错误。SDK 可提取 manifest，稍后同一文件在完整/最小环境中均可执行并退出 0；具体原因未确认，不能归因为权限、杀毒软件或产品名。保留的 NSIS 应用归档通过 7-Zip 完整性校验后，恢复其中已经完成 afterPack 检查的应用目录，用以下入口续做 NSIS 并成功退出 0：

   ```powershell
   cd E:\GitHub\ZCode\packages\desktop
   pnpm exec electron-builder --config electron-builder.config.js --win --x64 --prepackaged dist-fenjue\win-unpacked
   ```

   此命令要求延续上文 Fen Jue 构建环境，且应用目录已完整构建和验证；不能对缺失资源或未完成 afterPack 的目录使用。续做后再次检查运行依赖闭包、原生资源策略和安装包体积，并实际安装启动。

3. **启动诊断告警**：日志有 `Windows bundled runtime missing providers: glm`，目录快照同时包含 JS Agent bundle；安装目录内 CLI 的上述存储准备验证已成功。另有 `invalid host response message` 告警，未阻止 Host 与数据库 ready，具体消息来源未进一步归因。保留现场日志，不把“正常启动”写成“零告警”。

日志和验证脚本位于 `%LOCALAPPDATA%\fenjue-build-tools`：`bundle-windows-first-attempt.log`、`desktop-production.log`、`nsis-resume.log`、`native-windows.log`、`entry-shim-windows.log`、`verify-package.mjs`、`verify-cli.cjs`。应用主进程日志位于业务数据根的 `v2\logs\2026-11-27.log`。一次性启动/截图计划任务已移除，应用保持运行。

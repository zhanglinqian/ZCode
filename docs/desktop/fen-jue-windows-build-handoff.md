# Fen Jue Windows 构建交接

2026-11-27 交接。目标：在 Windows 机器上构建出 `Fen Jue-4.0.0-win-x64.exe`，安装到 `D:\Program Files`。

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

## 二、Windows 侧进度（未完成）

已确认的阻塞点与处置：

| 项                    | 结论                                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 能否在 macOS 交叉构建 | **不能**。预装工具入口 shim 的 CMakeLists 硬性要求 MSVC（`if(NOT MSVC) FATAL_ERROR`），构建脚本在非 Windows 平台直接跳过；Windows 打包的 afterPack 会硬校验 entry shim、runtime-host、installer-process-helper 三个 exe，缺一即失败 |
| Windows 机器现状      | Node v24.12、corepack 0.34.5、Python 3.14.3、CMake 4.4.2 可用；**只装了 Visual Studio 18.11（VS 2026）**，没有 VS 2022                                                                                                              |
| 已做的适配            | 新增 `ZCODE_WINDOWS_VS_GENERATOR` 环境变量，可把生成器从默认 `Visual Studio 17 2022` 切到 `Visual Studio 18 2026`。覆盖点：runtime-host、entry shim、native-search 三处原生构建；默认值不变，CI 基线不受影响                        |
| 代码就绪情况          | 工作区已在目标机器建好独立 worktree（不影响主仓库的本地改动），分支跟踪 `origin/feature/20261125-fenjue`；拉取最新提交即可                                                                                                          |

**Windows 上还没跑过一次真实构建**——这是交接后要做的第一件事。

## 三、接手步骤

### 0. 取代码

已有 worktree 时（推荐，不碰主仓库本地改动）：

```powershell
git -C E:\GitHub\ZCode-fenjue pull --ff-only
```

新机器直接克隆：

```powershell
git clone -b feature/20261125-fenjue git@github.com:zhanglinqian/ZCode.git E:\GitHub\ZCode-fenjue
```

确认 HEAD 含 `2453d7bc`（生成器覆盖）。

### 1. 前置检查

| 依赖                      | 要求                                        | 检查命令                                                |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| Node.js                   | 24.x                                        | `node -v`                                               |
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
cd E:\GitHub\ZCode-fenjue
pnpm install
$env:ZCODE_ENV = "production"
$env:ZCODE_FENJUE_IDENTITY = "1"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm bundle:desktop -- win x64
```

arm64 机器把末尾参数换成 `win arm64`。

构建链会自动产出并校验 Windows 专属产物（entry shim、runtime-host、installer-process-helper），无需手工准备。

### 3. 产物

```
packages\desktop\dist\Fen Jue-4.0.0-win-x64.exe
```

### 4. 安装到 D:\Program Files

- 运行安装器 → Advanced 页把安装目录改为 `D:\Program Files\Fen Jue`（向导已允许改目录）。
- 构建未签名，SmartScreen 提示后选「仍要运行」；`D:\Program Files` 需要管理员权限时以管理员身份运行安装器。
- 业务数据根是 `%USERPROFILE%\.fen-jue-home\.zcode`（独立，不碰官方 `%USERPROFILE%\.zcode`）；Electron userData 是 `%APPDATA%\Fen Jue`。

## 四、验收清单

- [ ] 安装器可运行，安装目录为 `D:\Program Files\Fen Jue`
- [ ] 应用名显示 `Fen Jue`；安装目录/开始菜单不出现 `ZCode`
- [ ] 首次启动正常，无缺模块崩溃（重点看主进程日志）
- [ ] 业务数据落在 `%USERPROFILE%\.fen-jue-home\.zcode`，CLI 会话库 ready，无 `startup_status_timeout`
- [ ] 官方 ZCode（如已装）启动不受影响，仍用 `%USERPROFILE%\.zcode`
- [ ] 自动更新入口不存在（Fen Jue 不接官方 feed）
- [ ] 设置页 MiniMax 额度卡正常（需订阅 Key）

## 五、已知限制

- **CUA 不可用**：外部签名 Helper 的 launcher 信任列表只含官方 appId 与 Preview，`dev.fenjue.app` 不在其中，CUA 会 fail-closed。恢复需要重新签名 Helper 并扩展信任列表，属独立工作项；交接中不要通过开发逃生开关绕过。
- **图标沿用上游**，未做 Fen Jue 品牌图形。
- **界面文案**仍有 `ZCode` 字样（窗口标题与系统产品名已是 Fen Jue，但全量替换未做）。
- **Windows 端从未实机构建/安装**，上述 Windows 步骤基于仓库构建链与上游 CI 配置推导；首次执行若报错，优先核对 VS 生成器名与 Python 版本。

## 六、参考

- `docs/desktop/fen-jue-product-identity.md`：产品身份规则、构建命令、边界与验收
- `docs/desktop/zcode-preview-packaging.md`：既有 flavor 机制规范（production / preview）
- `docs/preinstalled-tools/windows-entry-shim.md`：入口 shim 的 MSVC 构建契约
- `packages/shared/src/node/dataRootPaths.ts`：数据根唯一解析器

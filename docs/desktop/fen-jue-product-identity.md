# Fen Jue 独立桌面产品

## 产品规则

Fen Jue 是当前源码构建出的完整 Electron 应用，不是启动器，也不执行另一份 ZCode.app。此前启动器只是临时并跑方案，不再作为最终交付。

用户确认（2026-11-27）：生产后端、内置独立业务数据根、独立 appId、暂沿用图标；接受外部 CUA Helper 因签名信任限制暂不可用。

| 事实                     | Fen Jue                                            | 官方构建回归要求                |
| ------------------------ | -------------------------------------------------- | ------------------------------- |
| 构建开关                 | `ZCODE_FENJUE_IDENTITY=1`，只接受空/0/1            | 原 production/preview 判定保留  |
| 身份                     | `fenjue` / `dev.fenjue.app` / `Fen Jue`            | `dev.zcode.app` 与 Preview 不变 |
| 后端                     | `ZCODE_ENV=production`                             | 测试后端仍强制 Preview          |
| Linux executable/package | `fenjue`                                           | 原名称不变                      |
| Electron userData        | appData/Fen Jue                                    | 各身份独立                      |
| 默认业务 base            | HOME/.fen-jue-home                                 | production/preview 仍为 HOME    |
| 业务目录                 | HOME/.fen-jue-home/.zcode                          | 官方仍为 HOME/.zcode            |
| 更新                     | 不初始化官方更新器、不触发强更、不显示检查更新入口 | production 策略不变             |
| 预装工具                 | 使用 production release，目录位于自身业务根下      | 不新增远端 release 值           |
| CUA Helper 变体          | fenjue                                             | 不放宽签名或 Team 校验          |
| 图标                     | 暂沿用现有素材                                     | 本轮不生成新品牌图形            |

两个身份开关都须先校验；生产后端同时启用两个开关时 Fen Jue 优先。测试或未知后端始终 Preview，不能被开关改成正式产品。

## 所有者与启动顺序

```text
构建身份解析器 desktop-product-identity.mjs
  ├─ electron-builder → appId / productName / 完整 .app / 安装包名
  └─ tsup + vite → 编译期 ZCODE_PRODUCT_FLAVOR
       ├─ Main → 应用名 / Electron userData / 单实例锁
       └─ shared/node 数据根解析器 → 默认业务根（早于设置服务创建）
            └─ Main buildHostProcessEnv → ZCODE_DATA_BASE_DIR
                 └─ Host → CLI Agent → 同一个业务根
```

数据根仍由 shared/node 的唯一解析器维护。显式环境目录和运行时用户目录配置沿用原优先级；没有外部环境变量时，桌面包按编译期身份选默认根。CLI 不注入桌面身份常量，作为子进程时由 Main/Host 传递实际路径，不声称独立 CLI 也自动采用 Fen Jue 身份。

用户级 AGENTS.md、`.agents`、`.claude` 等真实 HOME 语义文件，以及用户选中的项目目录，不随产品改名迁移。继续沿用当前 HOME/.fen-jue-home 的业务数据，不再次搬库。

## 边界和已知限制

- 独立 appId 不等于独立后端或账号服务；OAuth、套餐等仍连接生产服务。
- `zcode://` 仍为上游 OAuth/支付等回调协议，两个产品安装后系统只保留一个默认处理器，不能保证回到发起登录的实例。本轮不绕过服务端 redirect URI 校验，也不承诺消除该冲突。
- 外部签名 CUA Helper 的 launcher requirement 仅接受官方 appId/Preview 与指定 Team。`dev.fenjue.app` 暂不受信任；保持 fail-closed，不启用开发逃生开关、不扩大 allowlist、不修改外部签名产物。恢复需合法提供信任 Fen Jue 签名主体的 Helper。
- 不全局替换协议名、包名、服务 URL、版权/第三方声明或产品文案中的所有 ZCode 字样。系统产品名和主窗口标题为 Fen Jue。
- 本轮只本机构建安装，不修改上游发布流水线、不提交或推送、不触发上传发布。

## 构建命令

```sh
ZCODE_ENV=production ZCODE_FENJUE_IDENTITY=1 ZCODE_DESKTOP_DIST_DIR=dist-fenjue pnpm bundle:desktop
```

`dist-fenjue` 独立保存 Fen Jue 产物，不覆盖原 `dist` 中的 ZCode 构建。

## 验收

1. 身份工程测试覆盖开关真值、生产/测试组合、Windows AUMID，以及原 production/preview 回归。
2. 数据根工程测试覆盖 Fen Jue 默认根、显式目录覆盖、运行时覆盖与已有 HOME 行为；构建期常量用 bundle 验证，不仅断言辅助函数。
3. Main/Host/Renderer 编译进同一身份；预装工具的 release 映射可验证。
4. 安装包的 Info.plist 为 `Fen Jue` / `dev.fenjue.app`，包含 Mach-O 主程序、Electron Framework、app.asar、内置 Agent。
5. 移除两个外部启动隔离变量后直接启动 Fen Jue.app；核对独立 userData、CLI 会话库 ready、官方实例继续使用自身目录。
6. 安装前确认当前目标是旧启动器；只替换该目标，不删除或覆盖官方 `/Applications/ZCode.app`，不清空日志/数据库。旧启动器仅在成功验收后移出安装目录。
7. `pnpm typecheck`、`pnpm lint`、架构检查和必要工程测试报告真实结果。无有效 CUA Producer/签名资源时，不将 CUA 验证写成通过。

## Windows 构建

Windows 安装包（NSIS，`Fen Jue-4.0.0-win-x64.exe`）**必须在 Windows 机器上构建**，与上游 CI 的 Windows runner 构建方式一致。不能在 macOS 上产出，原因是硬性契约而非工具缺失：

- 入口 shim 的 CMakeLists 明确 `if(NOT MSVC) FATAL_ERROR`（安全敏感组件，依赖 /guard:cf、/Brepro 等 MSVC 专属选项保证可复现字节）；`prepare:preinstalled-entry-shim` 脚本在非 Windows 平台直接跳过。
- Windows 打包的 afterPack 硬校验三个 exe（entry shim、runtime-host、installer-process-helper）存在，缺一即失败。macOS 上既无法产出也不会静默跳过——不通过放宽构建契约来"凑出"安装包。

Windows 机器前置：

| 依赖                                                      | 用途                                             |
| --------------------------------------------------------- | ------------------------------------------------ |
| Node.js 24 + corepack（pnpm）                             | JS 构建链                                        |
| Git                                                       | 取源码                                           |
| Visual Studio Build Tools 2022（含 C++ 生成工具与 CMake） | 编译 entry shim、runtime-host、node-gyp 原生模块 |
| Python 3.10+                                              | node-gyp                                         |

PowerShell 步骤（源码快照 zip 由 macOS 侧提供，含全部 fenjue 改动与本文档；`git ls-files` 口径打包，无 node_modules）：

```powershell
Expand-Archive fen-jue-src-<日期>.zip -DestinationPath D:\src\fen-jue
cd D:\src\fen-jue
corepack enable
pnpm install
$env:ZCODE_ENV = "production"
$env:ZCODE_FENJUE_IDENTITY = "1"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
pnpm bundle:desktop -- win x64
```

产物：`packages/desktop/dist/Fen Jue-4.0.0-win-x64.exe`。arm64 机器把末尾参数换成 `win arm64`。

安装要点：

- NSIS 向导已开启「允许更改安装目录」，Advanced 页把目录改为 `D:\Program Files\Fen Jue` 即可；默认装到用户目录。
- 构建未签名（`ZCODE_ENABLE_WINDOWS_SIGN` 未开），SmartScreen 会提示"仍要运行"；`D:\Program Files` 需要管理员权限时以管理员身份运行安装器。
- 安装后 Fen Jue 的业务数据根是 `%USERPROFILE%\.fen-jue-home\.zcode`（独立，不碰官方 `%USERPROFILE%\.zcode`），Electron userData 是 `%APPDATA%\Fen Jue`。业务数据根不进安装目录，且 Windows 侧本就禁止把数据根配到安装目录内。
- CUA 限制与 macOS 相同：外部 Helper 的签名信任不含 `dev.fenjue.app`，恢复路径见上文。

## 2026-11-27 本机验证

- 工程测试 45/45 通过（产品身份、真实 esbuild 编译期数据根、tsup define、shared 路径）；`pnpm typecheck`、`pnpm lint`（0 errors，538 warnings）、架构检查（0 violations）通过。
- CLI 类型检查 34/34 tasks 成功；CLI lint 0 errors、87 warnings（另有 3 项原样上游行数诊断）。
- 完整构建产生 `dist-fenjue/mac-arm64/Fen Jue.app`，Info.plist 为 `Fen Jue` / `dev.fenjue.app`，主程序是 arm64 Mach-O，包含 Electron Framework、app.asar 与内置 `glm/zcode.cjs`；DMG/ZIP 构建成功。
- 安装 `/Volumes/data/Applications/Fen Jue.app`，替换原脚本启动器。移除外部 `ZCODE_DESKTOP_APPLICATION_NAME`、`ZCODE_DATA_BASE_DIR` 等变量直接打开；运行进程未携带这两个变量，已加载自身 app.asar 与 Frameworks。
- lsof 确认 Fen Jue Agent 使用 `~/.fen-jue-home/.zcode/cli/db/db.sqlite`，数据库 phase 为 ready；官方进程仍加载 `/Applications/ZCode.app` 和 `~/.zcode/cli/db/db.sqlite`。未动用户数据库或清空日志。
- CUA 因独立签名身份限制未验收；图标仍沿用上游，系统身份独立不等于全界面文案已完成品牌替换。

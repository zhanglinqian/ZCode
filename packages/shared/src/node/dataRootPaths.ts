/**
 * ZCode 数据根（data root）的唯一解析入口。
 *
 * ## 为什么需要这一个模块
 *
 * 桌面端支持多实例并行：开发实例通过 `ZCODE_DATA_BASE_DIR` 指向独立目录，
 * 与正式版（默认 `HOME`）共用同一套代码。此前 App 与 CLI 两侧各自散落着
 * "从 HOME 直拼 `.zcode/...`" 的实现（App 侧 60+ 处、CLI 侧 3 套），
 * 结果是双实例并行时两边写到同一个物理目录：
 *
 * - CLI 会话库被两个实例抢锁 → `SQLite startup failed: startup_status_timeout`
 * - setting.json 被开发实例写进正式版目录
 * - skills / commands / plugins 等 App 与 Agent 共享的配置互相覆盖
 *
 * 更关键的是**双边必须一致**：App 写 `~/.zcode/skills`、Agent 读 `~/.zcode/skills`，
 * 若只让一侧跟随数据根，App 写的新文件 Agent 读不到（反向同理），配置直接失效。
 * 因此解析规则必须只有一份，由本模块提供，两侧都调用它。
 *
 * ## 解析规则
 *
 * ```txt
 * 数据根       = $ZCODE_DATA_BASE_DIR ?? {默认数据根}
 * ZCode 数据根 = {数据根}/.zcode
 * ```
 *
 * - `ZCODE_DATA_BASE_DIR` 缺省或为空 → 使用按产品身份决定的默认数据根。
 * - `ZCODE_DATA_BASE_DIR` 与默认数据根相同 → 同样回落默认，避免正式版出现
 *   "路径变了但内容没搬"的静默分叉。
 *
 * 默认数据根按**编译期产品身份**决定（`ZCODE_PRODUCT_FLAVOR`）：
 *
 * | 身份 | 默认数据根 | 说明 |
 * |---|---|---|
 * | `production` / `preview` | `$HOME` | 两者共享 `~/.zcode`，与既有行为一致 |
 * | `fenjue` | `$HOME/.fen-jue-home` | 二开版独立数据根，任务库与凭据库都不与正式版共用 |
 *
 * Desktop 的默认根来自编译期身份，不需要外部启动器。Main 再通过既有
 * Host/Agent env 传递实际根，CLI 因而沿用同一路径；独立运行的 CLI 未注入
 * 桌面 flavor，仍保留 HOME 默认语义。
 *
 * ## 边界
 *
 * 只有 **ZCode 数据根**（`.zcode/**`）随实例隔离。以下属于「用户家目录语义」，
 * **不**跟随数据根，否则会破坏与 Claude Code 等外部工具的约定：
 * `~/.claude/**`、`~/.agents/**`、`~/.ssh/**`、`~/Library/**`、`~/Applications/**`。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { ZCODE_PRODUCT_FLAVOR, type ZCodeProductFlavor } from "../env.js";

export const ZCODE_DATA_BASE_DIR_ENV_KEY = "ZCODE_DATA_BASE_DIR";

/** Fen Jue（二开版）的默认数据根目录名；与正式版的 `~/.zcode` 完全分离。 */
const FENJUE_DATA_BASE_DIR_NAME = ".fen-jue-home";

// App 进程可以在读取 bootstrap settings 后运行时切换数据根；CLI 子进程则通过 env
// 继承同一个根。只有默认调用（env === process.env）读取这个进程内覆盖，显式传入 env
// 的测试/CLI 解析仍以调用方材料为准，避免全局状态污染注入测试。
let runtimeDataBaseDir: string | null = null;

/** 设置当前 App 进程的数据根；传 null 恢复 env / HOME 默认解析。 */
export function setZCodeDataBaseDir(dir: string | null): void {
  runtimeDataBaseDir = dir?.trim() || null;
}

/**
 * 解析当前实例的数据根（`$ZCODE_DATA_BASE_DIR` ?? 按产品身份的默认根）。
 *
 * `env` 显式传入时按传入值解析：调用方通常有自己的 env 注入点（测试隔离、
 * CLI 子进程 env），直接读 process.env 会绕过注入导致路径落到真实家目录。
 */
export function resolveZCodeDataBaseDir(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env === process.env && runtimeDataBaseDir) {
    return runtimeDataBaseDir;
  }
  const configured = env[ZCODE_DATA_BASE_DIR_ENV_KEY]?.trim();
  if (configured) {
    return configured;
  }
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  const baseHome = home && home.length > 0 ? home : homedir();
  return resolveDefaultDataBaseDir(baseHome);
}

/**
 * 按产品身份解析默认数据根。
 *
 * 正式版与 Preview 继续共用 `$HOME`（`~/.zcode`）；Fen Jue 用独立的
 * `~/.fen-jue-home`，否则两个实例共用同一个 SQLite 会话库会重现
 * "SQLite startup failed: startup_status_timeout"（2026-11-26 实测）。
 *
 * `flavor` 默认取编译期常量；显式传入只为让测试能覆盖各身份的默认根。
 */
export function resolveDefaultDataBaseDir(
  home: string,
  flavor: ZCodeProductFlavor = ZCODE_PRODUCT_FLAVOR,
): string {
  if (flavor === "fenjue") {
    return join(home, FENJUE_DATA_BASE_DIR_NAME);
  }
  return home;
}

/** 解析 ZCode 数据根（`{数据根}/.zcode`）。 */
export function resolveZCodeDataRootDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveZCodeDataBaseDir(env), ".zcode");
}

/**
 * 解析 CLI 数据目录（`{数据根}/.zcode/cli`）。
 *
 * `cli/**` 下的 config.json、log、db 由 App 与 Agent 共读写，两侧必须解析到
 * 同一路径——因此统一走数据根，而不是各自直拼 homedir。
 */
export function resolveZCodeCliDir(env: Record<string, string | undefined> = process.env): string {
  return resolveZCodeDataRootPath("cli", env);
}

/**
 * 解析 ZCode 数据根下的相对路径。
 *
 * 相对路径必须以 `/` 或 `.` 开头才视为数据根相对（避免把 `~/foo`、绝对路径
 * 误当相对路径拼到数据根下）。
 */
export function resolveZCodeDataRootPath(
  relativePath: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const relative = relativePath.replace(/^[./]+/, "");
  return join(resolveZCodeDataRootDir(env), relative);
}

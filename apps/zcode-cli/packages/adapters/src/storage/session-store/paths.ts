import { homedir } from "node:os";
import { join } from "node:path";

/** 历史默认路径（homedir 直拼）。数据根未隔离时保持不变，正式版行为不受影响。 */
export const LEGACY_DEFAULT_SESSION_DB_PATH = "~/.zcode/cli/db/db.sqlite";

/**
 * 默认 CLI 会话库路径。
 *
 * 数据根感知：桌面双实例并行时用 ZCODE_DATA_BASE_DIR 隔离业务数据根，但本路径此前
 * 写死 homedir()，两个实例的 CLI 会共用 ~/.zcode/cli/db/db.sqlite 并在同一个库上抢锁，
 * 存储准备拿不到首帧即报 "SQLite startup failed: startup_status_timeout"
 * （2026-11-26 双实例打开同一 workspace 实测复现）。
 * 因此缺省路径改为跟随数据根（$BASE/.zcode/cli/db/db.sqlite）；
 * ZCODE_DATA_BASE_DIR 缺省或等于 homedir 时保持历史路径。
 */
export function getDefaultSessionDbPath(): string {
  const dataBaseDir = process.env.ZCODE_DATA_BASE_DIR?.trim();
  if (dataBaseDir && dataBaseDir !== homedir()) {
    return join(dataBaseDir, ".zcode", "cli", "db", "db.sqlite");
  }
  return join(homedir(), ".zcode", "cli", "db", "db.sqlite");
}

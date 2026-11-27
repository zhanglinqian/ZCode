import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { resolveZCodeDataRootDir, resolveZCodeDataRootPath } from "@zcode/shared/node";

const HOME_PREFIX = "~/";

export interface SubagentStorageOptions {
  homeDir?: string;
}

export function resolveUserHomeDir(options?: SubagentStorageOptions): string {
  if (options?.homeDir && options.homeDir.trim().length > 0) {
    return options.homeDir;
  }
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

export async function resolveUserSubagentRoot(options?: SubagentStorageOptions): Promise<string> {
  return join(await resolveZCodeStorageRoot(options), "agents");
}

export function resolveWorkspaceSubagentRoot(workspacePath: string): string {
  return join(workspacePath, ".zcode", "agents");
}

export async function resolveSubagentStateFile(options?: SubagentStorageOptions): Promise<string> {
  return join(await resolveZCodeStorageRoot(options), "v2", "agents-state.json");
}

export async function resolveZCodeStorageRoot(options?: SubagentStorageOptions): Promise<string> {
  const config = await readUserCliConfig(options);
  const storage = isObjectRecord(config.storage) ? config.storage : {};
  const storageDir =
    typeof storage.dir === "string" && storage.dir.trim().length > 0
      ? storage.dir.trim()
      // 用户级 subagent 存储根随数据根隔离（与 CLI 侧 storageRoot 同规则）；
      // homeDir 显式注入时保持注入目录语义（测试隔离）。
      : options?.homeDir?.trim()
        ? "~/.zcode"
        : resolveZCodeDataRootDir();
  return resolveConfigPath(storageDir, options);
}

export function resolveConfigPath(path: string, options?: SubagentStorageOptions): string {
  const expanded = path.startsWith(HOME_PREFIX)
    ? join(resolveUserHomeDir(options), path.slice(HOME_PREFIX.length))
    : path;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

async function readUserCliConfig(
  options?: SubagentStorageOptions,
): Promise<Record<string, unknown>> {
  try {
    // CLI user config 与 CLI 同一份数据根（双实例隔离）；homeDir 显式注入时优先（测试隔离）。
    const raw = await readFile(
      options?.homeDir?.trim()
        ? join(resolveUserHomeDir(options), ".zcode", "cli", "config.json")
        : resolveZCodeDataRootPath("cli/config.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as unknown;
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

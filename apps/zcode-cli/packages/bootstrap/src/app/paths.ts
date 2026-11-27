import { basename, join } from "node:path";
import { createProjectId, type ProjectId } from "@zcode/contracts";
import { resolveZCodeDataRootDir } from "@zcode/shared/node";
import { resolveProjectMemoryRoot } from "@zcode/core";

/** contracts DefaultRuntimeConfig.storage.dir 的缺省字面量；等值时按数据根解析。 */
export const DEFAULT_STORAGE_DIR = "~/.zcode";

/**
 * 缺省 storage root 跟随数据根（$BASE/.zcode）：桌面双实例并行时 Host 注入
 * ZCODE_DATA_BASE_DIR，CLI 子进程继承同一 env，两侧因此解析到同一份存储根。
 * 未设置（正式版）时解析结果与历史路径一致。显式配置的 storage.dir 仍按
 * resolvePath 的 ~/ → 真实家目录语义展开，不受影响。
 */
export function resolveDefaultStorageRoot(): string {
  return resolveZCodeDataRootDir();
}

export function getCliStorageRoot(storageRoot: string): string {
  return basename(storageRoot) === "cli" ? storageRoot : join(storageRoot, "cli");
}

/** 子代理输出目录（output.txt、metadata.json）的根；runtime 写入与子代理投影读取共用。 */
export function getSubagentOutputRootDir(cliStorageRoot: string): string {
  return join(cliStorageRoot, "agents");
}

export function getPluginStorageRoot(cliStorageRoot: string): string {
  return join(cliStorageRoot, "plugins");
}

export function getModelIoDir(cliStorageRoot: string, isDevelopment: boolean): string {
  return join(cliStorageRoot, isDevelopment ? "debug" : "rollout");
}

export function getProjectMemoryRoot(
  cliStorageRoot: string,
  workingDirectory: string,
  workspaceIdentity?: string,
): string {
  return resolveProjectMemoryRoot({
    cliStorageRoot,
    workspaceIdentity,
    workspacePath: workingDirectory,
  });
}

export function projectIdFromDirectory(directory: string): ProjectId {
  return createProjectId(
    directory
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "default",
  );
}

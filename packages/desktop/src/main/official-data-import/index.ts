import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateOfficialDataImportRoots } from "./officialDataImportPaths.js";

import type { OfficialDataImportOperation as Operation } from "./contract.js";
import type {
  OfficialDataImportEstimate as Estimate,
  OfficialDataImportProgress as Progress,
} from "./contract.js";
const roots = new Set([
  "agent",
  "agents",
  "claude-config",
  "cli",
  "codex",
  "commands",
  "hooks",
  "plugins",
  "projects",
  "session",
  "skills",
  "v2",
  "workspace",
]);
const excluded =
  /^(?:credentials(?:\.json)?|credential-source|logs?|cache|tmp|crash|debug|runtime|locks|exec|image-cache|node-fallback|bots-runtime-locks|telemetry-state\.json|.*-shm|.*\.lock|.*\.tmp|setting\.json\..*)$/i;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("invalid-import-directory");
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(
  root: string,
  parts: string[] = [],
): Promise<{ path: string; bytes: number }[]> {
  const files: { path: string; bytes: number }[] = [];
  for (const entry of (await readdir(join(root, ...parts), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if ((!parts.length && !roots.has(entry.name)) || excluded.test(entry.name)) continue;
    const child = [...parts, entry.name];
    if (entry.isDirectory()) files.push(...(await inventory(root, child)));
    else if (entry.isFile() || entry.isSymbolicLink()) {
      const info = await lstat(join(root, ...child));
      files.push({ path: join(...child), bytes: info.size });
    } else throw new Error("unsupported-import-file");
  }
  return files;
}

/** 确认框前的数据量预估：只读遍历，按顶层根聚合文件数与字节（符号链接按链接自身计）。 */
async function estimateRoot(root: string | undefined): Promise<Estimate | undefined> {
  if (!root || !(await exists(root))) return undefined;
  await assertDirectory(root);
  const files = await inventory(root);
  const byRoot = new Map<string, { files: number; bytes: number }>();
  let totalBytes = 0;
  for (const file of files) {
    const key = file.path.split(sep)[0] ?? "";
    const bucket = byRoot.get(key) ?? { files: 0, bytes: 0 };
    bucket.files += 1;
    bucket.bytes += file.bytes;
    totalBytes += file.bytes;
    byRoot.set(key, bucket);
  }
  return {
    fileCount: files.length,
    totalBytes,
    roots: [...byRoot.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

function verifyDatabases(root: string, files: string[]): void {
  for (const file of files) {
    if (!/\.(?:sqlite|db)$/i.test(file)) continue;
    const database = new DatabaseSync(join(root, file), { readOnly: true });
    try {
      const result = database.prepare("PRAGMA quick_check").all();
      if (result.length !== 1 || result[0]?.quick_check !== "ok") {
        throw new Error("invalid-import-database");
      }
    } finally {
      database.close();
    }
  }
}

function pauseImportedAutomations(root: string, files: string[]): void {
  for (const file of files) {
    if (basename(file) !== "tasks-index.sqlite") continue;
    const database = new DatabaseSync(join(root, file));
    try {
      const table = database
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'automations'")
        .get();
      if (table) database.exec("UPDATE automations SET enabled = 0 WHERE enabled <> 0");
    } finally {
      database.close();
    }
  }
}

export function createOfficialDataImport(source: string, target: string) {
  const state = join(dirname(target), `${basename(target)}-official-import`);
  const pending = join(state, "pending");
  const stage = join(state, "stage");
  const backup = join(state, "backup");

  async function status() {
    if (await exists(state)) await assertDirectory(state);
    let skippedLinks = 0;
    if (await exists(join(state, "result.json"))) {
      const result = JSON.parse(await readFile(join(state, "result.json"), "utf8"));
      if (Number.isSafeInteger(result.skippedLinks) && result.skippedLinks > 0) {
        skippedLinks = result.skippedLinks;
      }
    }
    return {
      sourceAvailable: await exists(source),
      backupAvailable: await exists(backup),
      skippedLinks,
    };
  }

  /** 确认框前的只读预估：import 统计官方源，restore 统计现有备份。 */
  async function estimate(restore: boolean): Promise<Estimate | undefined> {
    return estimateRoot(restore ? backup : source);
  }

  /** 是否有等待执行的迁移；启动流程据此决定是否先开进度窗口。 */
  async function hasPending(): Promise<boolean> {
    if (await exists(state)) await assertDirectory(state);
    return exists(pending);
  }

  async function schedule(operation: Operation) {
    await validateOfficialDataImportRoots(source, target, operation === "restore");
    if ((operation === "import") === (await exists(backup))) {
      throw new Error("import-backup-state-changed");
    }
    await mkdir(state, { recursive: true, mode: 0o700 });
    await assertDirectory(state);
    await writeFile(pending, JSON.stringify({ operation, id: randomUUID() }), {
      flag: "wx",
      mode: 0o600,
    });
  }

  async function run(onProgress?: (progress: Progress) => void): Promise<Operation | undefined> {
    if (await exists(state)) await assertDirectory(state);
    if (!(await exists(pending))) return;
    const { operation, id } = JSON.parse(await readFile(pending, "utf8"));
    if (
      (operation !== "import" && operation !== "restore") ||
      typeof id !== "string" ||
      !/^[\da-f-]{36}$/.test(id)
    ) {
      throw new Error("invalid-import-journal");
    }
    // 进度双通道：回调推给进度窗口；节流落盘 progress.json 供崩溃后诊断。
    let lastPersistedAt = 0;
    const emit = async (
      phase: Progress["phase"],
      processedFiles: number,
      processedBytes: number,
      totalFiles: number,
      totalBytes: number,
    ): Promise<void> => {
      const progress: Progress = {
        operation,
        phase,
        processedFiles,
        processedBytes,
        totalFiles,
        totalBytes,
      };
      onProgress?.(progress);
      const now = Date.now();
      if (phase === "done" || now - lastPersistedAt >= 200) {
        lastPersistedAt = now;
        await writeFile(join(state, "progress.json"), JSON.stringify(progress)).catch(() => {});
      }
    };
    const displaced = operation === "import" ? backup : join(state, `before-restore-${id}`);
    const replacement = operation === "import" ? stage : backup;
    if (await exists(displaced)) {
      await assertDirectory(displaced);
      // A crash between the two renames can leave a newly created bootstrap directory.
      if (await exists(replacement)) {
        await assertDirectory(replacement);
        if (await exists(target)) await rename(target, join(state, `bootstrap-${id}`));
        await rename(displaced, target);
        if (operation === "import") await rm(stage, { recursive: true });
        await rm(pending);
        throw new Error("interrupted-import-rolled-back");
      }
      await rm(pending);
      return operation;
    }

    try {
      await validateOfficialDataImportRoots(source, target, operation === "restore");
      if (operation === "import") {
        await rm(stage, { recursive: true, force: true });
        await mkdir(stage, { mode: 0o700 });
        const files = await inventory(source);
        if (!files.length) throw new Error("empty-import-source");
        const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
        const hashes = new Map<string, string>();
        const links = new Map<string, string>();
        let skippedLinks = 0;
        let processedFiles = 0;
        let processedBytes = 0;
        for (const file of files) {
          const dest = join(stage, file.path);
          await mkdir(dirname(dest), { recursive: true });
          const sourceFile = join(source, file.path);
          if ((await lstat(sourceFile)).isSymbolicLink()) {
            // 官方目录包含 skills 等兼容链接；递归跟随会重复复制或越过数据根。
            // 复制链接自身，内部引用改指最终目标根，目录联接无需 Windows 符号链接提权。
            const raw = await readlink(sourceFile);
            links.set(file.path, raw);
            let directory: boolean;
            try {
              directory = (await stat(sourceFile)).isDirectory();
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
              skippedLinks++;
              processedFiles += 1;
              await emit("copy", processedFiles, processedBytes, files.length, totalBytes);
              continue;
            }
            const resolved = await realpath(sourceFile);
            const delta = relative(await realpath(source), resolved);
            const internal = !isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`);
            const destination = internal ? resolve(target, delta) : resolved;
            await symlink(
              destination,
              dest,
              directory ? (process.platform === "win32" ? "junction" : "dir") : "file",
            );
            processedFiles += 1;
            processedBytes += file.bytes;
            await emit("copy", processedFiles, processedBytes, files.length, totalBytes);
            continue;
          }
          await copyFile(join(source, file.path), dest);
          hashes.set(file.path, await digest(dest));
          processedFiles += 1;
          processedBytes += file.bytes;
          await emit("copy", processedFiles, processedBytes, files.length, totalBytes);
        }
        if (
          JSON.stringify(files.map((file) => file.path)) !==
          JSON.stringify((await inventory(source)).map((file) => file.path))
        ) {
          throw new Error("import-source-changed");
        }
        await emit("verify", 0, 0, files.length, totalBytes);
        let verified = 0;
        for (const [file, hash] of hashes) {
          if ((await digest(join(source, file))) !== hash) throw new Error("import-source-changed");
          verified += 1;
          await emit("verify", verified, processedBytes, files.length, totalBytes);
        }
        for (const [file, link] of links) {
          if ((await readlink(join(source, file))) !== link)
            throw new Error("import-source-changed");
        }
        // 数据库校验只处理实际复制的文件，不能经链接打开官方或外部数据库。
        const copiedFiles = [...hashes.keys()];
        verifyDatabases(stage, copiedFiles);
        pauseImportedAutomations(stage, copiedFiles);
        await writeFile(join(state, "result.json"), JSON.stringify({ skippedLinks }));
        const settings = join(stage, "v2", "setting.json");
        if (await exists(settings)) {
          const value = JSON.parse(await readFile(settings, "utf8"));
          delete value.dataBaseDir;
          delete value.webRemoteControlLastEnabledContext;
          await writeFile(settings, JSON.stringify(value, null, 2));
        }
      }
      await emit("swap", 0, 0, 0, 0);
      await assertDirectory(replacement);
      await rename(target, displaced);
      try {
        await rename(replacement, target);
      } catch (error) {
        await rename(displaced, target);
        throw error;
      }
    } catch (error) {
      if (!(await exists(displaced))) {
        if (operation === "import") await rm(stage, { recursive: true, force: true });
        await rm(pending);
      }
      throw error;
    }
    await emit("done", 0, 0, 0, 0);
    await rm(pending);
    return operation;
  }

  return { status, estimate, hasPending, schedule, run };
}

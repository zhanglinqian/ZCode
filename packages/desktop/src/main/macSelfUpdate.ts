/**
 * Fen Jue（二开版）macOS 自研增量更新的安装层。
 *
 * 背景：官方增量更新链路（ManifestUpdateProvider 发现 → MacUpdater blockmap 差分下载）
 * 在 mac 上只到「下载完成」为止；下载后的安装由原生 Squirrel.Mac 接管，而 Squirrel 用
 * ShipIt 校验「更新包签名 == 已装应用签名」，ad-hoc 签名（无 Developer ID）必然被拒
 * （SQRLUpdaterErrorDomain code 2；Apple TN2318 明确 ad-hoc 不可用于分发）。
 *
 * 本模块绕开 Squirrel：拿到 electron-updater 已下载（含差分）的 zip 后，
 * ① Ed25519 验签 + sha512 校验（manifest 走 HTTP 无 TLS，sha512 只保证传输完整、
 *    不保证来源可信；公钥编进客户端，私钥在发布方 ~/.workbuddy/secrets）；
 * ② 生成自包含安装器脚本并以 detached 进程运行：等旧进程退出 → 解压 zip →
 *    旧 .app 移入 backup → 新 .app 移入原位 → ad-hoc 重签（codesign --force --deep
 *    --sign -，Electron 框架的原始 ad-hoc 封印在替换后会失效，必须重签才能启动）→
 *    open 新 .app → 写 result.json；
 * ③ 重启后 consumeLastInstallResult() 读取结果，失败时由调用方触发 backup 还原。
 *
 * 仅 fenjue + darwin 打包态使用；production/preview 有 Developer ID 签名，继续走 Squirrel。
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFile, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { app } from "electron";
import { logger } from "./logger.js";

/** 更新发布物 Ed25519 公钥（SPKI PEM）。私钥在发布方 secrets，绝不入仓库/服务器。 */
const FENJUE_UPDATE_SIGNING_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJtjtRkvFoW3rFQkvTy1f/0mmnQteEkUN3M3DfUc4hLg=
-----END PUBLIC KEY-----`;

const INSTALL_RESULT_FILE = "last-install-result.json";
const INSTALL_SCRIPT_FILE = "apply-update.sh";
/** 安装器等旧进程退出的预算；prepareAppQuit 已保证 host/agent 退出，60s 只是兜底。 */
const OLD_PROCESS_EXIT_TIMEOUT_SECONDS = 60;

export type MacInstallResult = {
  status: "success" | "failed";
  version: string;
  finishedAt: string;
  /** status=failed 时备份 .app 的位置，供还原。 */
  backupAppPath?: string;
  /** status=failed 时的目标安装位置（还原目的地）。 */
  targetAppPath?: string;
  error?: string;
};

export function resolveTargetAppPath(resourcesPath: string = process.resourcesPath): string {
  // resourcesPath = <.app>/Contents/Resources；向上两级回到 .app 根。
  return dirname(dirname(resourcesPath));
}

function resolveUpdateWorkDir(): string {
  return join(app.getPath("userData"), "self-update");
}

export type MacInstallerScriptInputs = {
  zipPath: string;
  newVersion: string;
  targetAppPath: string;
  workDir: string;
  /** 可注入以缩短测试等待；生产为 60s。 */
  oldProcessExitTimeoutSeconds?: number;
};

/** 纯函数：生成自包含安装器脚本。测试直接断言关键命令与失败恢复路径。 */
export function buildMacInstallerScript(inputs: MacInstallerScriptInputs): string {
  const {
    zipPath,
    newVersion,
    targetAppPath,
    workDir,
    oldProcessExitTimeoutSeconds = OLD_PROCESS_EXIT_TIMEOUT_SECONDS,
  } = inputs;
  const extractDir = join(workDir, "extracted");
  const backupAppPath = join(workDir, "backup.app");
  const resultPath = join(workDir, INSTALL_RESULT_FILE);

  return `#!/bin/bash
set -uo pipefail
TARGET_APP=${JSON.stringify(targetAppPath)}
ZIP_FILE=${JSON.stringify(zipPath)}
EXTRACT_DIR=${JSON.stringify(extractDir)}
BACKUP_APP=${JSON.stringify(backupAppPath)}
RESULT_FILE=${JSON.stringify(resultPath)}
VERSION=${JSON.stringify(newVersion)}

write_result() {
  printf '{"status":"%s","version":"%s","finishedAt":"%s","backupAppPath":"%s","targetAppPath":"%s","error":"%s"}\\n' \\
    "$1" "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$3" "$4" > "$RESULT_FILE"
}

# 等旧主进程退出；退出准备阶段 host/agent 已被回收，这里只兜底窗口期。
# 新 app 尚未启动，凡路径落在目标 .app 下的进程都是旧实例。
for _ in $(seq 1 ${oldProcessExitTimeoutSeconds}); do
  pgrep -f "$TARGET_APP/Contents/MacOS" >/dev/null 2>&1 || break
  sleep 1
done
if pgrep -f "$TARGET_APP/Contents/MacOS" >/dev/null 2>&1; then
  write_result failed "$BACKUP_APP" "$TARGET_APP" "old app process did not exit in time"
  exit 1
fi

rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
if ! unzip -q "$ZIP_FILE" -d "$EXTRACT_DIR"; then
  write_result failed "$BACKUP_APP" "$TARGET_APP" "unzip failed"
  exit 1
fi
NEW_APP="$(find "$EXTRACT_DIR" -maxdepth 2 -name "*.app" -type d | head -1)"
if [ -z "$NEW_APP" ]; then
  write_result failed "$BACKUP_APP" "$TARGET_APP" "no .app found in update zip"
  exit 1
fi

rm -rf "$BACKUP_APP"
if ! mv "$TARGET_APP" "$BACKUP_APP"; then
  write_result failed "$BACKUP_APP" "$TARGET_APP" "failed to move old app to backup"
  exit 1
fi
if ! mv "$NEW_APP" "$TARGET_APP"; then
  # 新 app 移入失败：还原旧 app，避免留下无法启动的状态。
  mv "$BACKUP_APP" "$TARGET_APP" 2>/dev/null
  write_result failed "" "$TARGET_APP" "failed to move new app into place (old app restored)"
  exit 1
fi

# Electron 框架的原始 ad-hoc 封印因内容替换而失效；必须重签才能启动。
if ! codesign --force --deep --sign - "$TARGET_APP"; then
  rm -rf "$TARGET_APP"
  mv "$BACKUP_APP" "$TARGET_APP" 2>/dev/null
  write_result failed "" "$TARGET_APP" "codesign failed (old app restored)"
  exit 1
fi

rm -rf "$EXTRACT_DIR"
write_result success "$BACKUP_APP" "$TARGET_APP" ""
open "$TARGET_APP"
`;
}

/**
 * Ed25519 验签 + sha512 校验下载好的更新 zip。
 * 签名文件约定为 zip URL 加 `.sig` 后缀（对 zip 原始字节签名，与 sha512 无关）。
 * 失败抛错，由调用方走既有失败收敛（handleAutoUpdateFailure），绝不进入安装阶段。
 */
export async function verifyDownloadedUpdateZip(zipPath: string, zipUrl: string): Promise<void> {
  const zipBytes = await readFile(zipPath);
  const digest = createHash("sha512").update(zipBytes).digest("hex");
  logger.info(`[mac-self-update] downloaded update zip sha512=${digest} size=${zipBytes.length}`);

  const signatureUrl = `${zipUrl.replace(/\/+$/, "")}.sig`;
  let response: Response;
  try {
    response = await fetch(signatureUrl, { cache: "no-store" });
  } catch (error) {
    throw new Error(`mac self-update signature fetch failed: ${signatureUrl} (${String(error)})`);
  }
  if (!response.ok) {
    throw new Error(`mac self-update signature fetch returned ${response.status}: ${signatureUrl}`);
  }
  const signatureBase64 = (await response.text()).trim();
  const signature = Buffer.from(signatureBase64, "base64");

  const publicKey = createPublicKey(FENJUE_UPDATE_SIGNING_PUBLIC_KEY);
  // Ed25519 是纯消息签名（无预摘要），算法参数必须传 null；sha512 仅另行作记录校验。
  const signatureValid = cryptoVerify(null, zipBytes, { key: publicKey }, signature);
  if (!signatureValid) {
    // 篡改或签名密钥不匹配：拒绝安装。这是 HTTP 明文 manifest 之外的独立信任锚。
    throw new Error("mac self-update signature verification failed; refusing to install");
  }
  logger.info("[mac-self-update] update zip signature verified (Ed25519)");
}

/**
 * 生成自包含安装器脚本并 detached 运行。返回后调用方应尽快完成退出准备并 exit——
 * 脚本靠轮询进程退出（而非信号）感知旧实例结束，主进程退出时间不计入预算风险。
 */
export async function stageInstallerAndRelaunch(options: {
  zipPath: string;
  newVersion: string;
}): Promise<void> {
  const targetAppPath = resolveTargetAppPath();
  const workDir = resolveUpdateWorkDir();
  await mkdir(workDir, { recursive: true });
  const scriptPath = join(workDir, INSTALL_SCRIPT_FILE);
  const resultPath = join(workDir, INSTALL_RESULT_FILE);
  // 上一次的结果在新的安装开始时失效，避免重启后误读旧状态。
  await rm(resultPath, { force: true });
  const script = buildMacInstallerScript({
    zipPath: options.zipPath,
    newVersion: options.newVersion,
    targetAppPath,
    workDir,
  });
  await writeFile(scriptPath, script, { mode: 0o755 });

  const child = spawn("/bin/bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
    // 安装器必须独立于应用进程树存活；应用随即 exit(0)。
    // macOS 上 detached 会创建新进程组，父进程退出不波及。
  });
  child.unref();
  logger.info(
    `[mac-self-update] installer staged script=${scriptPath} zip=${options.zipPath} target=${targetAppPath} version=${options.newVersion}`,
  );
}

/**
 * 重启后读取上一次安装结果。失败时返回 backup 供调用方还原（还原成功后清空
 * result，避免循环）。`workDir` 可注入供测试。
 */
export async function consumeLastInstallResult(
  workDirOverride?: string,
): Promise<MacInstallResult | null> {
  const resultPath = join(workDirOverride ?? resolveUpdateWorkDir(), INSTALL_RESULT_FILE);
  if (!existsSync(resultPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(resultPath, "utf8")) as MacInstallResult;
    if (parsed.status === "success") {
      // 成功的 backup 是唯一回滚点，V1 保留不自动清；文档写明手动清理路径。
      logger.info(
        `[mac-self-update] previous self-update succeeded version=${parsed.version}; backup kept at ${parsed.backupAppPath ?? "(unknown)"}`,
      );
      await rm(resultPath, { force: true });
      return parsed;
    }
    logger.warn(
      `[mac-self-update] previous self-update FAILED version=${parsed.version} error=${parsed.error ?? "unknown"} backup=${parsed.backupAppPath ?? "(none)"}`,
    );
    return parsed;
  } catch (error) {
    logger.warn(`[mac-self-update] failed to read install result: ${String(error)}`);
    return null;
  }
}

/**
 * 还原失败的更新：把 backup.app 移回原位并重签。仅在读到 failed 结果且 backup
 * 存在时调用；成功后清空 result 防止循环还原。
 */
export async function restoreFailedUpdate(workDirOverride?: string): Promise<boolean> {
  const workDir = workDirOverride ?? resolveUpdateWorkDir();
  const result = await consumeLastInstallResult(workDir);
  if (!result || result.status !== "failed" || !result.backupAppPath || !result.targetAppPath) {
    return false;
  }
  if (!existsSync(result.backupAppPath)) {
    logger.error(`[mac-self-update] backup missing, cannot restore: ${result.backupAppPath}`);
    return false;
  }
  const resultPath = join(workDir, INSTALL_RESULT_FILE);
  try {
    if (existsSync(result.targetAppPath)) {
      await rm(result.targetAppPath, { recursive: true, force: true });
    }
    await rename(result.backupAppPath, result.targetAppPath);
    await rm(resultPath, { force: true });
    logger.info("[mac-self-update] backup restored after failed self-update");
    return true;
  } catch (error) {
    logger.error(`[mac-self-update] restore failed: ${String(error)}`);
    return false;
  }
}

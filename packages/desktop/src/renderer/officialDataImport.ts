/**
 * Fen Jue 官方数据迁移进度窗口的渲染脚本。
 *
 * 迁移执行体在 main（run onProgress 推送），这里只负责展示：copy/verify 阶段显示
 * 文件与字节进度，swap 显示不确定进度条，done 切完成态并给出「重启应用」，
 * failed 切失败态（run 内部已回滚，现有数据保留）并给出「退出」。
 * locale 由 main 通过 query 传入，页面不读系统语言。
 */
const locale = new URLSearchParams(location.search).get("locale") === "en-US" ? "en-US" : "zh-CN";

const messages = {
  "zh-CN": {
    title: "迁移官方 ZCode 数据",
    preparing: "准备迁移…",
    copy: "正在复制文件…",
    verify: "正在校验完整性…",
    swap: "正在切换数据目录…",
    done: "迁移完成",
    failed: "迁移未完成，现有数据已保留",
    counts: (files: number, bytes: string) => `${files.toLocaleString()} 个文件 · ${bytes}`,
    doneDetail:
      "已切换到官方 ZCode 的历史与配置，重启后生效。原数据保留为可恢复备份（设置 → 数据同步）。",
    restart: "重启应用",
    quit: "退出",
  },
  "en-US": {
    title: "Import official ZCode data",
    preparing: "Preparing…",
    copy: "Copying files…",
    verify: "Verifying integrity…",
    swap: "Switching data directory…",
    done: "Migration complete",
    failed: "Migration did not finish; your existing data is kept",
    counts: (files: number, bytes: string) => `${files.toLocaleString()} files · ${bytes}`,
    doneDetail:
      "Official history and settings are now active after restart. Your previous data is kept as a restorable backup (Settings → Data sync).",
    restart: "Restart app",
    quit: "Quit",
  },
} as const;

const t = messages[locale];

const phaseEl = document.getElementById("phase") as HTMLDivElement;
const barFill = document.getElementById("barFill") as HTMLDivElement;
const countsEl = document.getElementById("counts") as HTMLDivElement;
const doneDetail = document.getElementById("doneDetail") as HTMLDivElement;
const errorDetail = document.getElementById("errorDetail") as HTMLDivElement;
const restartBtn = document.getElementById("restartBtn") as HTMLButtonElement;
const quitBtn = document.getElementById("quitBtn") as HTMLButtonElement;

document.getElementById("title")!.textContent = t.title;
phaseEl.textContent = t.preparing;
restartBtn.textContent = t.restart;
quitBtn.textContent = t.quit;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const phaseLabels: Record<string, string> = {
  copy: t.copy,
  verify: t.verify,
  swap: t.swap,
  done: t.done,
};

interface Progress {
  phase: "copy" | "verify" | "swap" | "done";
  processedFiles: number;
  processedBytes: number;
  totalFiles: number;
  totalBytes: number;
}

function renderProgress(progress: Progress) {
  phaseEl.textContent = phaseLabels[progress.phase] ?? progress.phase;
  if (progress.phase === "copy" || progress.phase === "verify") {
    const ratio = progress.totalFiles > 0 ? progress.processedFiles / progress.totalFiles : 0;
    barFill.classList.remove("indeterminate");
    barFill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
    countsEl.textContent = t.counts(progress.processedFiles, formatBytes(progress.processedBytes));
    return;
  }
  if (progress.phase === "swap") {
    barFill.classList.add("indeterminate");
    countsEl.textContent = "";
    return;
  }
  barFill.classList.remove("indeterminate");
  barFill.style.width = "100%";
  countsEl.textContent = "";
}

function showActions(restart: boolean) {
  restartBtn.classList.toggle("hidden", !restart);
  quitBtn.classList.toggle("hidden", false);
}

// 最小窗口类型：这个页面的 bridge 由专用 preload 提供，不走主窗口的庞大契约。
interface OfficialDataImportBridge {
  onProgress(callback: (payload: Progress) => void): () => void;
  onFinished(callback: (payload: { skippedLinks: number }) => void): () => void;
  onFailed(callback: (payload: string) => void): () => void;
  restart(): void;
  quit(): void;
}

const bridge = (window as unknown as { officialDataImportBridge: OfficialDataImportBridge })
  .officialDataImportBridge;

bridge.onProgress((progress) => renderProgress(progress));
bridge.onFinished(() => {
  renderProgress({
    phase: "done",
    processedFiles: 0,
    processedBytes: 0,
    totalFiles: 0,
    totalBytes: 0,
  });
  phaseEl.textContent = t.done;
  doneDetail.classList.remove("hidden");
  showActions(true);
});
bridge.onFailed((code) => {
  phaseEl.textContent = t.failed;
  barFill.classList.remove("indeterminate");
  barFill.style.width = "100%";
  barFill.style.background = "#ff6b60";
  countsEl.textContent = "";
  errorDetail.textContent = code;
  errorDetail.classList.remove("hidden");
  showActions(false);
});

restartBtn.addEventListener("click", () => {
  restartBtn.disabled = true;
  bridge.restart();
});
quitBtn.addEventListener("click", () => {
  quitBtn.disabled = true;
  bridge.quit();
});

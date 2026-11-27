/**
 * Fen Jue 官方数据迁移的启动期进度窗口。
 *
 * 迁移（official-data-import run）必须发生在任何服务打开 SQLite 之前的引导阶段，
 * 此刻主窗口与服务都未就绪，所以进度走一个专用小窗口：main 执行 run 并把
 * onProgress 推给窗口，完成态由窗口给出「重启应用」按钮（relaunch 冷启跑在
 * 迁移后的数据上），失败态（run 内部已回滚）给出「退出」。
 *
 * 窗口创建失败时返回 "unavailable"，调用方回退到旧的无进度路径。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { PlatformChannels } from "@zcode/shared";

export interface OfficialDataImportProgressDeps {
  /** official-data-import 的 run；进度经 onProgress 推给窗口。 */
  run: (onProgress?: (progress: unknown) => void) => Promise<string | undefined>;
  /** 完成后读取 skippedLinks，随 finished 事件推给窗口。 */
  skippedLinks: () => Promise<number>;
  /** 界面语言（zh/en 二选一，与 about 同口径）。 */
  locale: string;
  /** 生产为 out/renderer，开发经 devServerUrl 代理。 */
  rendererDir: string;
  devServerUrl?: string;
  /** 成功后点击「重启应用」：relaunch + quit，冷启即跑在迁移后的数据上。 */
  onRestart: () => void;
  /** 成功后未点重启直接关窗：迁移已生效，正常退出。 */
  onQuit: () => void;
  /** 失败（已回滚，旧数据保留）：与旧行为一致，非零退出让用户重新打开。 */
  onFailExit: () => void;
}

type Outcome = "handled" | "unavailable";

export async function runOfficialDataImportWithProgressWindow(
  deps: OfficialDataImportProgressDeps,
): Promise<Outcome> {
  const zh = deps.locale === "zh-CN" || !deps.locale;
  let win: BrowserWindow;
  try {
    win = new BrowserWindow({
      width: 480,
      height: 340,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: zh ? "迁移官方 ZCode 数据" : "Import official ZCode data",
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/officialDataImport.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  } catch {
    return "unavailable";
  }

  let failed = false;
  let settled = false;
  let settle: () => void = () => {};
  const settledPromise = new Promise<void>((resolve) => {
    settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      win.removeAllListeners("closed");
      resolve();
    };
  });
  const restart = () => {
    settle();
    deps.onRestart();
  };
  const finish = () => {
    settle();
    if (failed) deps.onFailExit();
    else deps.onQuit();
  };
  ipcMain.on(PlatformChannels.OfficialDataImportRestart, restart);
  ipcMain.on(PlatformChannels.OfficialDataImportQuit, finish);
  win.once("closed", finish);
  const cleanup = () => {
    ipcMain.removeListener(PlatformChannels.OfficialDataImportRestart, restart);
    ipcMain.removeListener(PlatformChannels.OfficialDataImportQuit, finish);
  };

  const localeQuery = zh ? "zh-CN" : "en-US";
  if (deps.devServerUrl) {
    void win.loadURL(`${deps.devServerUrl}/official-data-import.html?locale=${localeQuery}`);
  } else {
    void win.loadFile(join(deps.rendererDir, "official-data-import.html"), {
      search: `locale=${localeQuery}`,
    });
  }
  win.once("ready-to-show", () => win.show());

  try {
    const operation = await deps.run((progress) => {
      if (!win.isDestroyed()) {
        win.webContents.send(PlatformChannels.OfficialDataImportProgress, progress);
      }
    });
    const skippedLinks = await deps.skippedLinks();
    if (!win.isDestroyed()) {
      win.webContents.send(PlatformChannels.OfficialDataImportFinished, {
        operation,
        skippedLinks,
      });
    }
  } catch (error) {
    failed = true;
    const diagnostic = error as NodeJS.ErrnoException;
    const code =
      diagnostic.code ??
      (/^[a-z]+(?:-[a-z]+)+$/.test(diagnostic.message) ? diagnostic.message : "migration-failed");
    if (!win.isDestroyed()) {
      win.webContents.send(PlatformChannels.OfficialDataImportFailed, code);
    }
  }
  // 完成态 / 失败态都常驻窗口，等用户点「重启应用」或「退出」再收尾。
  await settledPromise;
  return "handled";
}

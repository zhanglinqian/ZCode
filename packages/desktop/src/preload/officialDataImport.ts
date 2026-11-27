/**
 * Fen Jue 官方数据迁移进度窗口的 preload。
 *
 * 迁移发生在重启后的引导阶段，主窗口与服务尚未就绪，所以这个窗口不复用主 preload，
 * 只暴露迁移 UI 需要的最小面：接收 main 推送的进度 / 完成 / 失败，以及请求重启或退出。
 */
import { contextBridge, ipcRenderer } from "electron";
import { PlatformChannels } from "@zcode/shared";

contextBridge.exposeInMainWorld("officialDataImportBridge", {
  /** 接收迁移进度（copy/verify/swap 阶段计数）。 */
  onProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(PlatformChannels.OfficialDataImportProgress, listener);
    return () => ipcRenderer.removeListener(PlatformChannels.OfficialDataImportProgress, listener);
  },
  /** 迁移成功完成；payload 含 operation 与 skippedLinks。 */
  onFinished: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(PlatformChannels.OfficialDataImportFinished, listener);
    return () => ipcRenderer.removeListener(PlatformChannels.OfficialDataImportFinished, listener);
  },
  /** 迁移失败；payload 为稳定错误码（run 内部已回滚，现有数据保留）。 */
  onFailed: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(PlatformChannels.OfficialDataImportFailed, listener);
    return () => ipcRenderer.removeListener(PlatformChannels.OfficialDataImportFailed, listener);
  },
  /** 完成态：relaunch 应用，冷启即跑在迁移后的数据上。 */
  restart: () => ipcRenderer.send(PlatformChannels.OfficialDataImportRestart),
  /** 失败态或用户放弃：退出应用（现有数据保留）。 */
  quit: () => ipcRenderer.send(PlatformChannels.OfficialDataImportQuit),
});

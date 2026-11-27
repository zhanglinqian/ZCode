export type OfficialDataImportOperation = "import" | "restore";

/** 确认框前的只读预估；bytes 为文件自身大小，符号链接按链接条目计。 */
export type OfficialDataImportEstimate = {
  fileCount: number;
  totalBytes: number;
  roots: { key: string; files: number; bytes: number }[];
};

/** 迁移进度：copy 逐文件推进，verify 复核哈希，swap 目录交换，done 收尾。 */
export type OfficialDataImportProgress = {
  operation: OfficialDataImportOperation;
  phase: "copy" | "verify" | "swap" | "done";
  processedFiles: number;
  processedBytes: number;
  totalFiles: number;
  totalBytes: number;
};

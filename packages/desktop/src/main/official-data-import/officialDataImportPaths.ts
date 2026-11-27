import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

async function existingDirectory(path: string): Promise<string> {
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("invalid-import-root");
  }
  const canonical = await realpath(path);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function contains(parent: string, candidate: string): boolean {
  const delta = relative(parent, candidate);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
}

/** Resolve both roots before comparing so aliases of an ancestor cannot bypass the guard. */
export async function validateOfficialDataImportRoots(
  source: string,
  target: string,
  restore = false,
): Promise<void> {
  if (!isAbsolute(source) || !isAbsolute(target)) {
    throw new Error("invalid-import-root");
  }
  const [sourceRoot, targetRoot] = await Promise.all([
    restore ? Promise.resolve(resolve(source)) : existingDirectory(resolve(source)),
    existingDirectory(resolve(target)),
  ]);
  if (contains(sourceRoot, targetRoot) || contains(targetRoot, sourceRoot)) {
    throw new Error("overlapping-import-roots");
  }
}

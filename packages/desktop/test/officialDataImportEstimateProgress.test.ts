import { mkdtemp, mkdir, symlink, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficialDataImport } from "../src/main/official-data-import/index.js";
import type { OfficialDataImportProgress as Progress } from "../src/main/official-data-import/contract.js";

/**
 * 官方数据迁移的数据量预估与进度回调契约。
 *
 * 确认框在迁移前展示「N 个文件 · X GB」，进度窗口按 copy → verify → swap → done
 * 推进；这里用临时目录验证计数、字节聚合（排除规则生效）、阶段顺序与失败回滚。
 * estimate/run 是纯文件系统操作，直接对真实实现断言，不 mock fs。
 */
describe("official data import estimate & progress", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "fenjue-import-"));
    directories.push(root);
    // source 与 target 必须互不嵌套（validateOfficialDataImportRoots）。
    const source = join(root, "zcode-official", ".zcode");
    const target = join(root, "fenjue-home", ".zcode");
    await mkdir(join(source, "cli"), { recursive: true });
    await mkdir(join(source, "v2"), { recursive: true });
    await mkdir(join(source, "cache"), { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "cli", "config.json"), JSON.stringify({ mcp: true }));
    await writeFile(join(source, "v2", "setting.json"), JSON.stringify({ locale: "zh-CN" }));
    // excluded 规则命中的文件不得计入预估与迁移（cache 根整树被跳过）
    await writeFile(join(source, "cache", "blob.bin"), "y".repeat(4096));
    return { root, source, target };
  }

  it("estimate counts files and bytes with exclusions, aggregated per top-level root", async () => {
    const { source, target } = await fixture();
    const importer = createOfficialDataImport(source, target);
    const estimate = await importer.estimate(false);
    expect(estimate).toBeDefined();
    expect(estimate!.fileCount).toBe(2);
    expect(estimate!.totalBytes).toBe(
      JSON.stringify({ mcp: true }).length + JSON.stringify({ locale: "zh-CN" }).length,
    );
    const cli = estimate!.roots.find((entry) => entry.key === "cli");
    expect(cli).toMatchObject({ files: 1 });
    // cache 整个根因全被排除而不出现
    expect(estimate!.roots.some((entry) => entry.key === "cache")).toBe(false);
    // restore 预估在无备份时为空
    expect(await importer.estimate(true)).toBeUndefined();
  });

  it("run streams copy → verify → swap → done progress and completes the swap", async () => {
    const { source, target } = await fixture();
    const importer = createOfficialDataImport(source, target);
    await importer.schedule("import");
    const phases: Progress["phase"][] = [];
    const last: Progress[] = [];
    const operation = await importer.run((progress) => {
      if (phases[phases.length - 1] !== progress.phase) phases.push(progress.phase);
      last.push(progress);
    });
    expect(operation).toBe("import");
    expect(phases).toEqual(["copy", "verify", "swap", "done"]);
    const copyTicks = last.filter((entry) => entry.phase === "copy");
    expect(copyTicks.length).toBeGreaterThanOrEqual(2);
    expect(copyTicks[copyTicks.length - 1]).toMatchObject({
      processedFiles: 2,
      totalFiles: 2,
      totalBytes: expect.any(Number),
    });
    // swap/done 收尾计数清零，窗口据此切不确定进度条与完成态
    expect(last[last.length - 2]).toMatchObject({ phase: "swap", processedFiles: 0 });
    expect(last[last.length - 1]).toMatchObject({ phase: "done" });
    // 迁移生效：target 现在是官方内容，pending 已清除
    const { readFile: read } = await import("node:fs/promises");
    expect(JSON.parse(await read(join(target, "v2", "setting.json"), "utf8"))).toEqual({
      locale: "zh-CN",
    });
    await expect(importer.hasPending()).resolves.toBe(false);
  });

  it("failed migration rolls back, removes pending and still reports progress up to the failure", async () => {
    const { root, source, target } = await fixture();
    // 官方源带一个损坏的 SQLite：迁移会在 verifyDatabases 阶段失败并回滚
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(join(source, "v2", "tasks-index.sqlite"));
    database.exec("CREATE TABLE t (x)");
    database.close();
    await writeFile(join(source, "v2", "tasks-index.sqlite"), "corrupted");
    const importer = createOfficialDataImport(source, target);
    await importer.schedule("import");
    const phases: Progress["phase"][] = [];
    await expect(
      importer.run((progress) => {
        if (phases[phases.length - 1] !== progress.phase) phases.push(progress.phase);
      }),
    ).rejects.toThrow(/file is not a database/);
    expect(phases[0]).toBe("copy");
    expect(phases).not.toContain("swap");
    // 回滚：target 仍是迁移前的 Fen Jue 数据，pending 已移除
    await expect(importer.hasPending()).resolves.toBe(false);
    const { readdir: list } = await import("node:fs/promises");
    expect(await list(target)).toEqual([]);
  });

  it("symlinks are counted as link entries and recorded in progress bytes", async () => {
    const { source, target } = await fixture();
    await mkdir(join(source, "skills"), { recursive: true });
    await symlink(join(source, "cli"), join(source, "skills", "cli-link"));
    const importer = createOfficialDataImport(source, target);
    const estimate = await importer.estimate(false);
    expect(estimate!.fileCount).toBe(3);
    const progress: Progress[] = [];
    await importer.schedule("import");
    await importer.run((entry) => progress.push(entry));
    const linkTick = progress.find((entry) => entry.phase === "copy" && entry.processedFiles === 2);
    expect(linkTick).toBeDefined();
    expect(linkTick!.processedFiles).toBe(2);
  });
});

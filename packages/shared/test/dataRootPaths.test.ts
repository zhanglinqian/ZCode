import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  resolveDefaultDataBaseDir,
  resolveZCodeDataBaseDir,
  resolveZCodeDataRootDir,
  resolveZCodeDataRootPath,
} from "@zcode/shared/node";

/**
 * 数据根解析契约。
 *
 * 桌面双实例并行时（开发实例用 ZCODE_DATA_BASE_DIR 指向独立目录），
 * App 与 CLI 两侧必须解析出同一个数据根：两边各自直拼 HOME 会写到同一物理
 * 目录，表现为 CLI 会话库抢锁报 startup_status_timeout、setting.json 互串、
 * skills/commands 互相覆盖。App 与 Agent 共享的目录尤其不能只迁一侧，
 * 否则会出现「App 写的新文件 Agent 读不到」的配置失效。
 */
// Windows 的拼接路径遵循宿主分隔符；显式传入的数据根仍须保留原值。
describe("ZCode 数据根解析", () => {
  it("缺省时落在用户家目录下的 .zcode", () => {
    const env = { HOME: "/Users/tester" };
    expect(resolveZCodeDataBaseDir(env)).toBe("/Users/tester");
    expect(resolveZCodeDataRootDir(env)).toBe(join("/Users/tester", ".zcode"));
  });

  it("ZCODE_DATA_BASE_DIR 优先于 HOME", () => {
    const env = { HOME: "/Users/tester", ZCODE_DATA_BASE_DIR: "/tmp/instance-home" };
    expect(resolveZCodeDataBaseDir(env)).toBe("/tmp/instance-home");
    expect(resolveZCodeDataRootDir(env)).toBe(join("/tmp/instance-home", ".zcode"));
    expect(resolveZCodeDataRootPath("cli/db/db.sqlite", env)).toBe(
      join("/tmp/instance-home", ".zcode", "cli", "db", "db.sqlite"),
    );
  });

  it("空串与纯空白视为未设置", () => {
    expect(resolveZCodeDataBaseDir({ HOME: "/Users/tester", ZCODE_DATA_BASE_DIR: "  " })).toBe(
      "/Users/tester",
    );
  });

  it("USERPROFILE 作为 Windows 下的家目录回退", () => {
    expect(resolveZCodeDataBaseDir({ USERPROFILE: "C:\\Users\\tester" })).toBe("C:\\Users\\tester");
  });

  it("相对路径解析到数据根下，不吞掉前导分隔符", () => {
    const env = { ZCODE_DATA_BASE_DIR: "/tmp/instance-home" };
    expect(resolveZCodeDataRootPath("cli/config.json", env)).toBe(
      join("/tmp/instance-home", ".zcode", "cli", "config.json"),
    );
    expect(resolveZCodeDataRootPath("./skills", env)).toBe(
      join("/tmp/instance-home", ".zcode", "skills"),
    );
  });

  it("默认数据根按产品身份决定：正式版与 Preview 共用家目录，Fen Jue 独立", () => {
    // 正式版与 Preview 共享 ~/.zcode（既有行为）。
    expect(resolveDefaultDataBaseDir("/Users/tester", "production")).toBe("/Users/tester");
    expect(resolveDefaultDataBaseDir("/Users/tester", "preview")).toBe("/Users/tester");
    // Fen Jue 独立数据根：任务库与凭据库都不与正式版共用，
    // 否则两个实例抢同一个 SQLite 会话库（startup_status_timeout）。
    expect(resolveDefaultDataBaseDir("/Users/tester", "fenjue")).toBe(
      join("/Users/tester", ".fen-jue-home"),
    );
  });

  it("显式 ZCODE_DATA_BASE_DIR 仍然优先于按身份的默认根", () => {
    // 用户显式配置与 e2e 注入不能被 flavor 默认值顶掉。
    expect(resolveDefaultDataBaseDir("/Users/tester", "fenjue")).not.toBe(
      resolveZCodeDataBaseDir({
        HOME: "/Users/tester",
        ZCODE_DATA_BASE_DIR: "/tmp/explicit",
      }),
    );
    expect(
      resolveZCodeDataBaseDir({ HOME: "/Users/tester", ZCODE_DATA_BASE_DIR: "/tmp/explicit" }),
    ).toBe("/tmp/explicit");
  });
});

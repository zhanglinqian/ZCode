import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";
import { resolvePreinstalledToolsRelease } from "@zcode/shared/preinstalled-tools";

import {
  desktopProductIdentities,
  resolveDesktopArtifactSuffix,
  resolveDesktopProductFlavor,
  resolveWindowsAppUserModelId,
  resolveWindowsAppUserModelIdForFlavor,
  resolveDesktopProductIdentity,
} from "../scripts/desktop-product-identity.mjs";
describe("desktop product identity", () => {
  it("根锁文件的发布版本与构建版本一致", () => {
    // 合并上游发布提交只对齐当前版本，不恢复上游旧版本，也不重算依赖锁。
    const readRootJson = (name: string) =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, "../../..", name), "utf8"));
    const version = readRootJson("package.json").version;
    const lock = readRootJson("package-lock.json");
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);
  });

  it("ZCODE_ENV=test 使用可与生产版并排安装的 Preview 身份", () => {
    expect(resolveDesktopProductIdentity({ ZCODE_ENV: "test" })).toEqual({
      flavor: "preview",
      appId: "dev.zcode.app.preview",
      productName: "ZCode Preview",
      linuxExecutableName: "zcode-preview",
      linuxPackageName: "zcode-preview",
      cuaHelperInstallVariant: "preview",
    });
  });

  it("ZCODE_PREVIEW_IDENTITY=1 让生产后端的构建改用 Preview 身份", () => {
    // 身份与后端环境分轴：同一份 Preview 身份既可以连测试后端，也可以连生产后端。
    for (const flag of ["1", " 1 "]) {
      const env = { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("preview");
      expect(resolveDesktopProductIdentity(env)).toBe(desktopProductIdentities.preview);
    }
    for (const flag of ["", "0"]) {
      const env = { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("production");
    }
  });

  it("开关只认 1/0：其它拼写在构建期直接失败，不能在路由层漏匹配却在脚本层开启", () => {
    // CI workflow 规则与 release 门做 == "1" 精确比较；若脚本层再接受 true/yes/on，
    // `ZCODE_PREVIEW_IDENTITY=true` 会落入 @electron/dev 生产验收目录却打出 Preview 身份包。
    for (const flag of ["true", "yes", "on", "false", "no", "off", "2"]) {
      expect(() =>
        resolveDesktopProductFlavor({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: flag }),
      ).toThrow(/expected 1 or 0/);
    }
  });

  it("测试后端永远是 Preview 身份，开关无法把它变成正式 ZCode", () => {
    expect(resolveDesktopProductFlavor({ ZCODE_ENV: "test", ZCODE_PREVIEW_IDENTITY: "0" })).toBe(
      "preview",
    );
    expect(resolveDesktopProductFlavor({ ZCODE_ENV: "test", ZCODE_PREVIEW_IDENTITY: "1" })).toBe(
      "preview",
    );
  });

  it("产物后缀只标记后端环境，生产后端的 Preview 包靠 productName 区分", () => {
    expect(resolveDesktopArtifactSuffix({ ZCODE_ENV: "test" })).toBe("_TEST");
    expect(resolveDesktopArtifactSuffix({ ZCODE_ENV: "production" })).toBe("");
    expect(
      resolveDesktopArtifactSuffix({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }),
    ).toBe("");
    expect(resolveDesktopArtifactSuffix({})).toBe("_TEST");
  });

  it("ZCODE_ENV=production 完整保留正式包身份", () => {
    expect(resolveDesktopProductIdentity({ ZCODE_ENV: "production" })).toBe(
      desktopProductIdentities.production,
    );
    expect(desktopProductIdentities.production).toEqual({
      flavor: "production",
      appId: "dev.zcode.app",
      productName: "ZCode",
      linuxExecutableName: "zcode",
      linuxPackageName: "zcode",
      cuaHelperInstallVariant: null,
    });
  });

  it("未注入或未知环境时不应误生成正式安装身份", () => {
    expect(resolveDesktopProductIdentity({}).flavor).toBe("preview");
    expect(resolveDesktopProductIdentity({ ZCODE_ENV: "staging" }).flavor).toBe("preview");
  });

  it("打包态 Windows AUMID 必须和 NSIS appId 保持一致", () => {
    expect(resolveWindowsAppUserModelId({ ZCODE_ENV: "production" })).toBe(
      desktopProductIdentities.production.appId,
    );
    expect(resolveWindowsAppUserModelId({ ZCODE_ENV: "test" })).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(
      resolveWindowsAppUserModelId({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }),
    ).toBe(desktopProductIdentities.preview.appId);
    // 主进程按编译期 flavor 取 AUMID，不依赖安装后机器上的环境变量。
    expect(resolveWindowsAppUserModelIdForFlavor("preview")).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(resolveWindowsAppUserModelIdForFlavor("production")).toBe(
      desktopProductIdentities.production.appId,
    );
  });

  it("ZCODE_FENJUE_IDENTITY=1 让生产后端的构建改用 Fen Jue 身份", () => {
    // Fen Jue 是二开版的独立产品：与正式版并排安装、独立 Electron 目录、独立业务数据根。
    for (const flag of ["1", " 1 "]) {
      const env = { ZCODE_ENV: "production", ZCODE_FENJUE_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("fenjue");
      expect(resolveDesktopProductIdentity(env)).toBe(desktopProductIdentities.fenjue);
    }
    for (const flag of ["", "0"]) {
      const env = { ZCODE_ENV: "production", ZCODE_FENJUE_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("production");
    }
  });

  it("Fen Jue 身份是一整套独立系统身份，不是只改显示名", () => {
    expect(desktopProductIdentities.fenjue).toEqual({
      flavor: "fenjue",
      appId: "dev.fenjue.app",
      productName: "Fen Jue",
      linuxExecutableName: "fenjue",
      linuxPackageName: "fenjue",
      cuaHelperInstallVariant: "fenjue",
    });
  });

  it("Fen Jue 开关只认 1/0：其它拼写在构建期直接失败", () => {
    // 与 Preview 开关同一套 fail-closed 语义：路由层做 == "1" 精确比较，
    // 脚本层若再接受 true/yes/on，会出现"路由层漏匹配、脚本层已开启"的分裂。
    for (const flag of ["true", "yes", "on", "false", "no", "off", "2"]) {
      expect(() =>
        resolveDesktopProductFlavor({ ZCODE_ENV: "production", ZCODE_FENJUE_IDENTITY: flag }),
      ).toThrow(/expected 1 or 0/);
    }
  });

  it("测试后端永远是 Preview 身份，Fen Jue 开关不能把它变成 Fen Jue 包", () => {
    // 与 Preview 开关同一条底线：测试后端包只能是 Preview 身份，
    // 否则连测试后端的二开包会带着独立 appId 覆盖用户的正式安装。
    expect(resolveDesktopProductFlavor({ ZCODE_ENV: "test", ZCODE_FENJUE_IDENTITY: "1" })).toBe(
      "preview",
    );
    expect(resolveDesktopProductFlavor({ ZCODE_ENV: "test", ZCODE_FENJUE_IDENTITY: "0" })).toBe(
      "preview",
    );
  });

  it("Fen Jue 产物不带 _TEST 后缀：它连的是生产后端", () => {
    expect(
      resolveDesktopArtifactSuffix({
        ZCODE_ENV: "production",
        ZCODE_FENJUE_IDENTITY: "1",
      }),
    ).toBe("");
  });

  it("打包态 Windows AUMID 必须与各自的 appId 一致", () => {
    expect(resolveWindowsAppUserModelId({ ZCODE_ENV: "production" })).toBe(
      desktopProductIdentities.production.appId,
    );
    expect(resolveWindowsAppUserModelId({ ZCODE_ENV: "test" })).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(
      resolveWindowsAppUserModelId({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }),
    ).toBe(desktopProductIdentities.preview.appId);
    expect(
      resolveWindowsAppUserModelId({ ZCODE_ENV: "production", ZCODE_FENJUE_IDENTITY: "1" }),
    ).toBe(desktopProductIdentities.fenjue.appId);
    // 主进程按编译期 flavor 取 AUMID，不依赖安装后机器上的环境变量。
    expect(resolveWindowsAppUserModelIdForFlavor("preview")).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(resolveWindowsAppUserModelIdForFlavor("production")).toBe(
      desktopProductIdentities.production.appId,
    );
    // Fen Jue 不能落到 production 的 AUMID：Windows Shell 会把两者的快捷方式
    // 与开始菜单索引当成同一个已注册应用。
    expect(resolveWindowsAppUserModelIdForFlavor("fenjue")).toBe(
      desktopProductIdentities.fenjue.appId,
    );
  });

  it("身份开关始终校验，测试后端不能绕过非法值，生产后端 Fen Jue 优先", () => {
    for (const ZCODE_ENV of ["production", "test"]) {
      expect(() =>
        resolveDesktopProductFlavor({ ZCODE_ENV, ZCODE_FENJUE_IDENTITY: "true" }),
      ).toThrow(/expected 1 or 0/);
      expect(() =>
        resolveDesktopProductFlavor({ ZCODE_ENV, ZCODE_PREVIEW_IDENTITY: "true" }),
      ).toThrow(/expected 1 or 0/);
    }
    expect(
      resolveDesktopProductFlavor({
        ZCODE_ENV: "production",
        ZCODE_FENJUE_IDENTITY: "1",
        ZCODE_PREVIEW_IDENTITY: "1",
      }),
    ).toBe("fenjue");
  });

  it("Fen Jue 从编译期身份直接解析数据根，不依赖启动器环境变量", () => {
    for (const flavor of ["production", "preview", "fenjue"]) {
      const result = buildSync({
        stdin: {
          contents: `import {resolveZCodeDataBaseDir} from './packages/shared/src/node/dataRootPaths.ts';
            console.log(JSON.stringify([
              resolveZCodeDataBaseDir({HOME:'/fixture'}),
              resolveZCodeDataBaseDir({HOME:'/fixture',ZCODE_DATA_BASE_DIR:'/explicit'})
            ]));`,
          resolveDir: resolve(import.meta.dirname, "../../.."),
        },
        bundle: true,
        write: false,
        platform: "node",
        format: "cjs",
        define: { __ZCODE_ENV__: '"production"', __ZCODE_PRODUCT_FLAVOR__: JSON.stringify(flavor) },
      });
      const output = execFileSync(process.execPath, ["-e", result.outputFiles[0]!.text], {
        encoding: "utf8",
      });
      expect(JSON.parse(output)).toEqual([
        flavor === "fenjue" ? "/fixture/.fen-jue-home" : "/fixture",
        "/explicit",
      ]);
    }
  });

  it("Fen Jue 复用 production 工具 release，不产生不存在的远端通道", () => {
    expect(
      resolvePreinstalledToolsRelease({ runtimeEnv: "production", productFlavor: "fenjue" }),
    ).toBe("production");
    expect(
      resolvePreinstalledToolsRelease({ runtimeEnv: "development", productFlavor: "fenjue" }),
    ).toBe("development");
  });

  it("开发态继续使用独立 AUMID，避免污染打包版 Shell 身份", () => {
    expect(resolveWindowsAppUserModelId({}, { isPackaged: false })).toBe("cn.aminer.zcode");
  });
});

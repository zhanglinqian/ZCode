/**
 * 构建期开关：为真时安装包使用 Preview 身份，而后端环境仍由 `ZCODE_ENV` 单独决定。
 * 典型用法是 `ZCODE_ENV=production ZCODE_PREVIEW_IDENTITY=1`，得到一个连接生产后端、
 * 可与正式版并排安装的 `ZCode Preview`。
 */
export const ZCODE_PREVIEW_IDENTITY_ENV = "ZCODE_PREVIEW_IDENTITY";

/**
 * 构建期开关：为真时安装包使用 Fen Jue（二开版）身份。
 *
 * 与 Preview 的差异：Fen Jue 不只是换名 —— 它有**独立的业务数据根**
 * （`~/.fen-jue-home`，见 packages/shared/src/node/dataRootPaths.ts），
 * 任务库与凭据库都不与正式版共享，因此可以与正式版长期并行运行。
 */
export const ZCODE_FENJUE_IDENTITY_ENV = "ZCODE_FENJUE_IDENTITY";

const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "dev.zcode.app",
  productName: "ZCode",
  linuxExecutableName: "zcode",
  linuxPackageName: "zcode",
  cuaHelperInstallVariant: null,
});

const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "dev.zcode.app.preview",
  productName: "ZCode Preview",
  linuxExecutableName: "zcode-preview",
  linuxPackageName: "zcode-preview",
  cuaHelperInstallVariant: "preview",
});

/**
 * Fen Jue（二开版）身份。
 *
 * appId 与正式版、Preview 都不同：macOS/Windows/Linux 才能把三份安装包并排装下，
 * 单实例锁、任务栏/Dock 图标、About 各自独立。
 */
const FENJUE_IDENTITY = Object.freeze({
  flavor: "fenjue",
  appId: "dev.fenjue.app",
  productName: "Fen Jue",
  linuxExecutableName: "fenjue",
  linuxPackageName: "fenjue",
  cuaHelperInstallVariant: "fenjue",
});

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
  fenjue: FENJUE_IDENTITY,
});

function normalizeDesktopZCodeEnv(env) {
  return env.ZCODE_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

/**
 * 开关只有一种开启拼写 `1`（`0` / 空 = 关闭），与 CI workflow 规则和 release 门的
 * `$ZCODE_PREVIEW_IDENTITY == "1"` 精确比较保持同一套语义。其它拼写在构建期直接失败，
 * 避免 `true` 之类在 YAML 路由层漏匹配、却在脚本层被当成开启，把 Preview 包打进生产验收目录。
 */
export function isPreviewIdentityRequested(env = process.env) {
  const value = env[ZCODE_PREVIEW_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${ZCODE_PREVIEW_IDENTITY_ENV}=${env[ZCODE_PREVIEW_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * Fen Jue 开关与 Preview 开关同一套真值语义：只认 `1`。
 *
 * 同样是 fail-closed 的理由——一个值在路由层、脚本层、构建层只需一种比较；
 * `ZCODE_FENJUE_IDENTITY=true` 必须在构建期就失败，不能静默打出正式 `ZCode` 身份。
 */
export function isFenJueIdentityRequested(env = process.env) {
  const value = env[ZCODE_FENJUE_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${ZCODE_FENJUE_IDENTITY_ENV}=${env[ZCODE_FENJUE_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * 产品身份（flavor）与后端环境（`ZCODE_ENV`）是两个轴：
 * - `ZCODE_ENV=test` 一律是 Preview，测试后端不能顶着正式 `ZCode` 身份覆盖用户的正式安装；
 * - `ZCODE_ENV=production` 默认是正式身份，显式 `ZCODE_PREVIEW_IDENTITY=1` 时改用 Preview 身份。
 * - `ZCODE_FENJUE_IDENTITY=1` 改用 Fen Jue 身份；它与 `ZCODE_ENV` 正交（可连生产后端），
 *   但测试后端仍固定为 Preview —— 不允许生成连测试后端的 Fen Jue 包。
 * 未知 `ZCODE_ENV` 继续按 test 处理，和共享层 normalizeZCodeEnv 的 fail-safe 默认值一致。
 */
export function resolveDesktopProductFlavor(env = process.env) {
  // 先校验两个开关的拼写：无效值必须在任何 env 组合下都 fail-closed，
  // 不能因为后端环境恰好是 test 就绕过校验（那样路由层漏匹配、脚本层已开启的
  // 分裂会重现）。校验只读不生效，生效顺序见下。
  const fenjueRequested = isFenJueIdentityRequested(env);
  const previewRequested = isPreviewIdentityRequested(env);
  // 测试后端一律 Preview：任何身份开关都不能把测试后端包变成正式 ZCode 或 Fen Jue。
  if (normalizeDesktopZCodeEnv(env) !== "production") {
    return "preview";
  }
  if (fenjueRequested) {
    return "fenjue";
  }
  if (previewRequested) {
    return "preview";
  }
  return "production";
}

export function resolveDesktopProductIdentity(env = process.env) {
  return desktopProductIdentities[resolveDesktopProductFlavor(env)];
}

/**
 * 产物文件名后缀标记的是后端环境而不是身份：`_TEST` 只出现在测试后端的安装包上。
 * 生产后端的 Preview 包靠 productName（`ZCode Preview-<version>-...`）与正式包区分。
 */
export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopZCodeEnv(env) === "test" ? "_TEST" : "";
}

/**
 * 返回 Windows Shell 使用的 AppUserModelId。
 *
 * 打包态必须复用 electron-builder 的 appId，否则快捷方式里的 AUMID、开始菜单索引
 * 和运行中的 Electron 进程会被 Windows 视为三个不同的应用。开发态继续保留旧身份，
 * 避免本地调试快捷方式和正式/Preview 安装包互相污染。
 */
export function resolveWindowsAppUserModelIdForFlavor(flavor, runtime = { isPackaged: true }) {
  if (runtime.isPackaged === false) {
    return "cn.aminer.zcode";
  }
  // 每个身份用各自的 appId：Windows Shell 靠 AUMID 区分应用，
  // 落到 production 会让 Fen Jue 的快捷方式与正式版指向同一个已注册应用。
  return desktopProductIdentities[
    flavor === "preview" || flavor === "fenjue" ? flavor : "production"
  ].appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(resolveDesktopProductFlavor(env), runtime);
}

const { _electron, chromium } = require("playwright-core");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fenjue-chain-"));
  const home = path.join(root, "home"),
    source = path.join(home, ".zcode"),
    target = path.join(home, ".fen-jue-home", ".zcode");
  console.log("Evidence directory", root);
  for (const dir of [source, target]) {
    await fs.mkdir(path.join(dir, "v2"), { recursive: true });
    await fs.mkdir(path.join(dir, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "v2", "setting.json"),
      JSON.stringify({ locale: "en-US", notificationEnabled: false }),
    );
  }
  await fs.writeFile(path.join(source, "skills", "official-marker.md"), "official fixture");
  await fs.writeFile(path.join(target, "skills", "fenjue-marker.md"), "original fixture");
  const external = path.join(root, "external-skills");
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "external.md"), "external fixture");
  const directoryLink = process.platform === "win32" ? "junction" : "dir";
  await fs.mkdir(path.join(source, "agent"));
  await fs.symlink(
    path.join(source, "skills"),
    path.join(source, "agent", "skills"),
    directoryLink,
  );
  await fs.symlink(external, path.join(source, "skills", "external"), directoryLink);
  await fs.symlink(path.join(root, "missing"), path.join(source, "agent", "broken"), directoryLink);
  const sourceBefore = await fs.readFile(path.join(source, "v2", "setting.json"), "utf8");
  await fs.mkdir(path.join(root, "bundled-agents", "win32-x64"), { recursive: true });
  await fs.cp(
    process.env.ZCODE_OFFICIAL_IMPORT_E2E_AGENT_DIR ??
      (() => {
        throw new Error(
          "Set ZCODE_OFFICIAL_IMPORT_E2E_AGENT_DIR to a compatible read-only glm runtime directory",
        );
      })(),
    path.join(root, "bundled-agents", "win32-x64", "glm"),
    { recursive: true },
  );
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const wrapper = path.join(root, "launch.cjs"),
    desktop = path.resolve("packages/desktop");
  await fs.writeFile(
    wrapper,
    [
      'const {app,dialog}=require("electron"); const fs=require("node:fs");',
      "app.setAppPath(" + JSON.stringify(desktop) + ");",
      'app.setPath("userData",process.env.ZCODE_DESKTOP_USER_DATA_DIR);',
      "fs.appendFileSync(" + JSON.stringify(path.join(root, "starts")) + ',process.pid+",");',
      "dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});",
      "dialog.showMessageBoxSync=()=>0;",
      "const relaunch=app.relaunch.bind(app);app.relaunch=()=>{fs.appendFileSync(" +
        JSON.stringify(path.join(root, "relaunches")) +
        ',"restart,");relaunch({args:[' +
        JSON.stringify(wrapper) +
        ',"--user-data-dir="+process.env.ZCODE_DESKTOP_USER_DATA_DIR,"--remote-debugging-port=' +
        port +
        '"]});};',
      "import(" +
        JSON.stringify(
          require("node:url").pathToFileURL(path.join(desktop, "out", "main", "index.js")).href,
        ) +
        ").catch(e=>{console.error(e);app.exit(1)});",
    ]
      .join("\n")
      .replaceAll("\\n", "\n"),
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(root, "appdata"),
    LOCALAPPDATA: path.join(root, "localappdata"),
    ZCODE_DESKTOP_HOME_DIR: home,
    ZCODE_DESKTOP_USER_DATA_DIR: path.join(root, "profile"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: path.join(root, "session"),
    ZCODE_DESKTOP_APPLICATION_NAME: "Migration " + path.basename(root),
    ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
    ELECTRON_RENDERER_URL: "http://127.0.0.1:5199",
  };
  for (const key of [
    "APPDATA",
    "LOCALAPPDATA",
    "ZCODE_DESKTOP_USER_DATA_DIR",
    "ZCODE_DESKTOP_SESSION_DATA_DIR",
  ])
    await fs.mkdir(env[key], { recursive: true });
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "ZCODE_DATA_BASE_DIR",
    "ZCODE_HOME",
    "ZCODE_AGENT_SERVER_COMMAND",
    "ZCODE_AGENT_SERVER_ARGS_JSON",
  ])
    delete env[key];
  const app = await _electron.launch({
    executablePath: require("electron"),
    args: [
      wrapper,
      "--user-data-dir=" + env.ZCODE_DESKTOP_USER_DATA_DIR,
      "--remote-debugging-port=" + port,
    ],
    env,
    cwd: root,
    timeout: 60000,
  });
  app.process().stderr.on("data", (x) => fs.appendFile(path.join(root, "stderr.log"), x));
  let page = await app.firstWindow({ timeout: 60000 });
  async function ready(p) {
    await p.waitForURL(/127\.0\.0\.1:5199/, { timeout: 120000 });
    await Promise.race([
      p.getByRole("button", { name: "Use API key", exact: true }).waitFor({ timeout: 120000 }),
      p.locator("[data-testid=task-settings-button]").waitFor({ timeout: 120000 }),
    ]);
    if (await p.getByRole("button", { name: "Use API key", exact: true }).count()) {
      await p.getByRole("button", { name: "Use API key", exact: true }).click();
      await p.getByRole("button", { name: "Skip for now", exact: true }).click();
    }
    await pause(2000);
    await p.keyboard.press("Escape");
    await p.keyboard.press("Control+,");
    await pause(1000);
    await fs.writeFile(
      path.join(root, "ui-" + Date.now() + ".txt"),
      await p.locator("body").innerText(),
    );
  }
  await ready(page);
  await page
    .locator("[data-testid=task-settings-button]")
    .click()
    .catch(() => {});
  await page.locator("[data-testid=settings-section-nav-dataSync]").click();
  console.log("READY", (await page.locator("body").innerText()).slice(0, 2000));
  await page.screenshot({ path: path.join(root, "before.png") });
  await fs.writeFile(path.join(root, "settings.txt"), await page.locator("body").innerText());
  const startsBefore = await fs.readFile(path.join(root, "starts"), "utf8");
  await page.getByRole("button", { name: "Import data from official ZCode", exact: true }).click();
  async function reconnect(previous) {
    for (let n = 0; n < 120; n++) {
      await pause(1000);
      const starts = await fs.readFile(path.join(root, "starts"), "utf8");
      if (starts !== previous) {
        try {
          const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
          const p = browser.contexts()[0].pages()[0];
          if (p) return { browser, page: p, starts };
        } catch {}
      }
    }
    throw new Error("Electron did not relaunch");
  }
  let second = await reconnect(startsBefore);
  page = second.page;
  await ready(page);
  await page
    .locator("[data-testid=task-settings-button]")
    .click()
    .catch(() => {});
  await page.locator("[data-testid=settings-section-nav-dataSync]").click();
  await page.getByRole("button", { name: "Restore Fen Jue backup", exact: true }).waitFor();
  assert.equal(
    await fs.readFile(path.join(target, "skills", "official-marker.md"), "utf8"),
    "official fixture",
  );
  assert.equal(
    await fs.readFile(path.join(target, "agent", "skills", "official-marker.md"), "utf8"),
    "official fixture",
  );
  assert.equal(
    await fs.realpath(path.join(target, "agent", "skills")),
    await fs.realpath(path.join(target, "skills")),
  );
  assert.equal(
    await fs.readFile(path.join(target, "skills", "external", "external.md"), "utf8"),
    "external fixture",
  );
  assert.equal(
    await fs.readFile(
      path.join(
        home,
        ".fen-jue-home",
        ".zcode-official-import",
        "backup",
        "skills",
        "fenjue-marker.md",
      ),
      "utf8",
    ),
    "original fixture",
  );
  assert.equal(await fs.readFile(path.join(source, "v2", "setting.json"), "utf8"), sourceBefore);
  await page.screenshot({ path: path.join(root, "imported.png") });
  await page.getByRole("button", { name: "Restore Fen Jue backup", exact: true }).click();
  const third = await reconnect(second.starts);
  page = third.page;
  await ready(page);
  assert.equal(
    await fs.readFile(path.join(target, "skills", "fenjue-marker.md"), "utf8"),
    "original fixture",
  );
  const archiveRoot = path.join(home, ".fen-jue-home", ".zcode-official-import");
  assert.equal(
    JSON.parse(await fs.readFile(path.join(archiveRoot, "result.json"), "utf8")).skippedLinks,
    1,
  );
  const archive = (await fs.readdir(archiveRoot)).find((x) => x.startsWith("before-restore-"));
  assert.ok(archive);
  assert.equal(
    await fs.readFile(path.join(archiveRoot, archive, "skills", "official-marker.md"), "utf8"),
    "official fixture",
  );
  assert.equal(await fs.readFile(path.join(source, "v2", "setting.json"), "utf8"), sourceBefore);
  const starts = await fs.readFile(path.join(root, "starts"), "utf8");
  assert.equal(starts.split(",").filter(Boolean).length, 3);
  assert.equal(
    (await fs.readFile(path.join(root, "relaunches"), "utf8")).split(",").filter(Boolean).length,
    2,
  );
  await page.screenshot({ path: path.join(root, "restored.png") });
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ passed: true, starts, archive, sourceUnchanged: true }, null, 2),
  );
  console.log(
    "PASS: settings import -> Electron relaunch -> backup -> settings restore -> Electron relaunch -> restored original; source unchanged",
  );
  // 两次真实重启后原调试通道仍可能保持连接，只清理本驱动记录的进程。
  for (const pid of starts.split(",").filter(Boolean)) {
    try {
      process.kill(Number(pid));
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await third.browser.close();
  await second.browser.close();
  console.log("ROOT", root);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

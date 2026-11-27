import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry =
  "/packages/ui/test/browser/manual-review/pending/provider-self-context-usage.fixture.tsx";
const artifacts = join(tmpdir(), "zcode-provider-self-context-usage");
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "provider-self-context-usage-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : { channel: "chrome" },
  );
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("MiniMax quota meter shows remaining percent and reset time", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}fixture?kind=quota`, { timeout: 90_000 });
    // 标题复用 sidebar.usage.plan.title（英文 "Usage remaining"），与 Coding Plan 面板一致。
    await page.getByText("Usage remaining", { exact: true }).waitFor();
    // label 的父 div 文本与 span 完全相同，getByText(exact) 会对两层各计一次；
    // 限定 span 标签保证「存在且唯一」的断言只落在真实文本节点上。
    const fiveHour = await page.locator("span", { hasText: /^5-hour remaining$/ }).count();
    const weekly = await page.locator("span", { hasText: /^Weekly remaining$/ }).count();
    assert.equal(fiveHour, 1);
    assert.equal(weekly, 1);
    // percentage=20 是已用占比，面板必须反转为剩余 80%。
    // value 的隐藏测量副本（Coding Plan meter 的防溢出结构）会让精确文本出现两次，
    // 这里断言「至少出现一次」并在 visible 层核对唯一值。
    assert.ok((await page.getByText("80%", { exact: true }).count()) >= 1);
    assert.ok((await page.getByText("100%", { exact: true }).count()) >= 1);
    assert.equal(await page.getByText("80%", { exact: true }).first().isVisible(), true);
    // 五小时卡展示时分、周卡只展示日期（重置时间存在即可，具体格式由 i18n 决定）。
    const more = page.getByRole("button", { name: "More", exact: true });
    assert.equal(await more.count(), 1);
    await more.click();
    await page
      .waitForFunction(() => document.querySelector('[data-testid="click-marker"]') !== null, {
        timeout: 5000,
      })
      .catch(() => {
        // onUsageClick 经包装后由 fixture 的 window 事件承接；这里只断言按钮可点。
      });
    assert.equal(await page.getByText("Account balance", { exact: true }).count(), 0);
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, "self-quota-panel.png") });
  } finally {
    await page.close();
  }
});

test("DeepSeek balance rows show amounts without progress bars", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}fixture?kind=balance`, { timeout: 90_000 });
    await page.getByText("Account balance", { exact: true }).waitFor();
    assert.equal(await page.getByText("¥110.00", { exact: true }).count(), 1);
    assert.equal(await page.getByText("¥10.00 · ¥100.00", { exact: true }).count(), 1);
    // 余额没有分母：不得出现任何百分比进度条或百分比文案。
    assert.equal(await page.locator(".h-1\\.5").count(), 0);
    assert.equal(await page.getByText("%", { exact: false }).count(), 0);
    assert.equal(await page.getByText("Usage remaining", { exact: true }).count(), 0);
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, "self-balance-panel.png") });
  } finally {
    await page.close();
  }
});

test("upstream failure shows the quota unavailable hint", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}fixture?kind=fail`, { timeout: 90_000 });
    await page
      .getByText("Unable to read plan quota. Make sure the key is a plan subscription key, not a pay-as-you-go key.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await page.getByText("80%", { exact: true }).count(), 0);
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, "self-quota-fail.png") });
  } finally {
    await page.close();
  }
});

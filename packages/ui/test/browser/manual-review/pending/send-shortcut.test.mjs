import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/send-shortcut.fixture.tsx";
let server, browser, origin;
before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "send-shortcut-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url !== "/send-shortcut") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<html><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
          });
        },
      },
    ],
    resolve: { alias: { "@": root + "packages/ui/src" } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : {},
  );
});
after(async () => {
  await browser?.close();
  await server?.close();
});
test(
  "send shortcut preset updates the real editor and survives reload",
  { timeout: 120000 },
  async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    page.on("pageerror", (error) => console.error(error.message));
    await page.goto(origin + "send-shortcut");
    const preset = page.getByTestId("settings-send-preset");
    await preset.waitFor();
    await preset.click();
    await page.getByRole("option", { name: /Always press/ }).click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("send-shortcut-fixture") ?? "{}").shortcutBindings
          ?.composerSend?.[0] === "CmdOrCtrl+Enter",
    );
    const editor = page.getByTestId("send-test-editor");
    await editor.fill("first");
    await editor.press("Enter");
    await editor.press("a");
    assert.equal(await page.getByTestId("sent-count").textContent(), "0");
    assert.match(await editor.innerText(), /first\s+a/);
    await editor.press("Control+Enter");
    assert.equal(await page.getByTestId("sent-count").textContent(), "1");
    await page.reload();
    await preset.waitFor();
    assert.match(await preset.innerText(), /Always press/);
    await preset.click();
    await page.getByRole("option", { name: "Press Enter to send", exact: true }).click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("send-shortcut-fixture") ?? "{}").shortcutBindings
          ?.composerSend?.[0] === "Enter",
    );
    await editor.fill("second");
    await editor.press("Shift+Enter");
    await editor.press("b");
    assert.equal(await page.getByTestId("sent-count").textContent(), "0");
    await editor.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    assert.equal(await page.getByTestId("sent-count").textContent(), "0");
    await editor.press("Enter");
    assert.equal(await page.getByTestId("sent-count").textContent(), "1");
    await page.close();
  },
);

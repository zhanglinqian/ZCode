import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/provider-settings-batch.fixture.tsx";
let server, browser, origin, rules, source, directory;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "isolated-gpt-reasoning",
        enforce: "pre",
        load(id) {
          if (id.endsWith("/settings/CodingPlanUpgradeDialogProvider.tsx"))
            return "export const useCodingPlanUpgradeDialog=()=>({openCodingPlanUpgrade:()=>false}); export const useOptionalCodingPlanUpgradeDialog=()=>null;";
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
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
  const { NodeZCodeBuiltinProviderConfigSource } = await server.ssrLoadModule(
    "/packages/provider-node/src/index.ts",
  );
  const release = JSON.parse(await readFile(`${root}config/provider/zcode-builtin.json`, "utf8"));
  delete release.config.modelConfigOverrides;
  release.revision = 48;
  directory = await mkdtemp(join(tmpdir(), "fenjue-gpt-browser-"));
  const activeFilePath = join(directory, "active.json");
  await writeFile(activeFilePath, JSON.stringify(release));
  source = new NodeZCodeBuiltinProviderConfigSource({
    bundledFilePath: `${root}config/provider/zcode-builtin.json`,
    activeFilePath,
    watch: false,
  });
  rules = (await source.read()).models;
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH });
});
after(async () => {
  await browser?.close();
  await server?.close();
  source?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const [width, locale, theme, apiType] of [
  [1200, "zh-CN", "dark", "openai-responses"],
  [390, "en-US", "light", "openai-chat-completions"],
]) {
  test(`GPT smart editor ${width}/${apiType}`, { timeout: 120000 }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(90000);
    const errors = [],
      writes = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route("**/resolve?*", (route) => {
      const modelId = new URL(route.request().url()).searchParams.get("id");
      return route.fulfill({
        json: {
          inheritedConfig: rules.resolve({ providerId: "isolated", modelId, apiType }).toJSON(),
          issues: [],
          revision: 1,
        },
      });
    });
    await page.route("**/mutation", (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    });
    try {
      await page.goto(`${origin}fixture?${new URLSearchParams({ editor: "1", locale, theme })}`);
      const id = page.locator("[data-model-identity-row] input");
      await id.fill("gpt-6.2-sol");
      await id.blur();
      await page.locator("[data-model-advanced-trigger]").click();
      const chips = page.locator("[data-model-reasoning-chip]");
      await chips.getByRole("button", { name: "max", exact: true }).waitFor();
      assert.deepEqual(
        await chips.evaluateAll((nodes) =>
          nodes.map((node) => node.querySelector("button").textContent),
        ),
        ["low", "medium", "high", "xhigh", "max"],
      );
      const map = page.locator("[data-model-reasoning-level-map-editor] textarea");
      const recommended = await map.getAttribute("placeholder");
      assert.match(
        recommended,
        apiType === "openai-responses" ? /"reasoning"/ : /"reasoning_effort"/,
      );
      assert.doesNotMatch(recommended, /thinking/);
      await page
        .locator("[data-model-settings-footer]")
        .getByRole("button", {
          name: locale === "zh-CN" ? "保存" : "Save",
          exact: true,
        })
        .click();
      await page.locator("[data-model-settings-footer]").waitFor({ state: "hidden" });
      assert.equal(writes.length, 1);
      assert.equal(writes[0].modelId, "gpt-6.2-sol");
      assert.equal(writes[0].personalConfig.optionSpecs?.reasoningLevel, undefined);
      await page.getByRole("button", { name: "Reopen editor" }).click();
      await id.fill("gpt-6.2-sol");
      await id.blur();
      const advanced = page.locator("[data-model-advanced-trigger]");
      if ((await advanced.getAttribute("aria-expanded")) !== "true") await advanced.click();
      await chips.getByRole("button", { name: "max", exact: true }).click();
      const levelInput = page.locator("[data-model-reasoning-level-input]");
      await levelInput.fill("custom");
      await levelInput.press("Enter");
      await id.fill("gpt-5.1");
      await id.blur();
      // 等待新推荐回包已应用到另一字段，再确认显式编辑未被覆盖。
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-model-settings-group="tokens"] input')
            ?.getAttribute("placeholder") === "400000",
      );
      assert.equal(await chips.getByRole("button", { name: "custom", exact: true }).count(), 1);
      assert.equal(await chips.count(), 5);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

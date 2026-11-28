/**
 * 模型接力设置页浏览器验收（docs/fen-jue/model-relay.md 检查点 R3）。
 *
 * 运行：CHROME_EXECUTABLE_PATH=<chrome> node --test model-relay.test.mjs
 * 覆盖：初始渲染、阈值滑动条写入、删除卡片、添加模型（按 5 小时额度过滤）；
 * 拖拽排序由键盘传感器覆盖一次（space → 方向键 → space）。
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/model-relay.fixture.tsx";

const INITIAL_CHAIN = {
  entries: [
    { providerId: "fixture-bigmodel", modelId: "GLM-5.4", thresholdPercent: 80 },
    { providerId: "fixture-minimax", modelId: "MiniMax-M3", thresholdPercent: 90 },
  ],
};
void INITIAL_CHAIN;

/** test 文件只负责浏览器脚手架；设置数据全部存在页面环境的 window.__modelRelayStore。 */

let server, browser, origin;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "isolated-model-relay",
        enforce: "pre",
        load(id) {
          // 注意后缀：这些 hook 的真实文件是 .ts/.tsx，alias 保留原后缀解析。
          if (id.endsWith("/hooks/useSettingService.ts")) {
            // 与真实 useSettings 同构：settings 快照 + update 后广播重渲染；
            // 没有订阅的话 update 不会触发组件重渲染（真实实现经 snapshot 状态下发）。
            return [
              'import { useEffect, useState } from "react";',
              "export function useSettings() {",
              "  const [, force] = useState(0);",
              "  useEffect(",
              "    () => globalThis.__modelRelayStore.subscribe(() => force((n) => n + 1)),",
              "    [],",
              "  );",
              "  return {",
              "    settings: globalThis.__modelRelayStore.settings,",
              "    update: async (patch) => {",
              "      globalThis.__modelRelayStore.settings = { ...globalThis.__modelRelayStore.settings, ...patch };",
              "      globalThis.__modelRelayStore.writes.push(JSON.parse(JSON.stringify(patch)));",
              "      globalThis.__modelRelayStore.emit();",
              "    },",
              "  };",
              "}",
            ].join("\n");
          }
          if (id.endsWith("/hooks/useWorkspaceServices.tsx")) {
            // 返回值必须跨渲染稳定：候选 hook 的 effect 依赖 usageStatsService 引用，
            // 每次渲染新对象会让结果被 cleanup 无限丢弃（真实 context 是稳定引用）。
            return [
              "const services = {",
              "  usageStatsService: {",
              "    getEntitlementSnapshot: async (request) => ({",
              "      provider: { id: request.preferredProviderId, name: request.preferredProviderId },",
              "      quota: { level: null, limits: [{ type: 'TIME_LIMIT', percentage: 42, usageDetails: [] }] },",
              "    }),",
              "  },",
              "};",
              "export function useOptionalBaseWorkspaceServices() {",
              "  return services;",
              "}",
            ].join("\n");
          }
          if (id.endsWith("/hooks/useProviderSettingsView.ts")) {
            return [
              "const read = {",
              "  state: {",
              "    status: 'ready',",
              "    view: {",
              "      revision: 1,",
              "      providerTemplates: [],",
              "      providerOrder: ['fixture-bigmodel', 'fixture-minimax'],",
              "      providers: [",
              "        { providerId: 'fixture-bigmodel', providerName: 'BigModel', enabled: true, executable: true, models: [{ modelId: 'GLM-5.4' }, { modelId: 'GLM-5.3' }], effectiveConfig: {} },",
              "        { providerId: 'fixture-minimax', providerName: 'MiniMax', enabled: true, executable: true, models: [{ modelId: 'MiniMax-M3' }], effectiveConfig: {} },",
              "      ],",
              "    },",
              "  },",
              "  reload() {},",
              "};",
              "export function useProviderSettingsView() {",
              "  return read;",
              "}",
            ].join("\n");
          }
          return undefined;
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
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
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("模型接力设置页", { timeout: 120000 }, async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    const listeners = new Set();
    window.__modelRelayStore = {
      settings: {
        modelRelayChain: {
          entries: [
            { providerId: "fixture-bigmodel", modelId: "GLM-5.4", thresholdPercent: 80 },
            { providerId: "fixture-minimax", modelId: "MiniMax-M3", thresholdPercent: 90 },
          ],
        },
      },
      writes: [],
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit() {
        for (const listener of listeners) listener();
      },
    };
  });
  await page.goto(`${origin}fixture?locale=zh-CN&theme=dark`);

  // 初始渲染：两张卡片、顺序、阈值、少于 2 张的提示不出现。
  await page.waitForSelector('[data-testid="model-relay-list"]');
  assert.deepEqual(
    await page.locator('[data-testid="model-relay-card"]').evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.cardModel),
    ),
    ["GLM-5.4", "MiniMax-M3"],
  );
  assert.equal(await page.locator('[data-testid="model-relay-inactive-hint"]').count(), 0);
  assert.equal(await page.locator('[data-testid="model-relay-slider-0-value"]').innerText(), "80%");

  // 拖拽排序：指针拖第一张卡片把手越过第二张卡片底缘（closestCenter 需要越过后才翻转）。
  const handle = await page
    .locator('[data-testid="model-relay-card"]')
    .first()
    .locator('[data-testid="model-relay-handle"]')
    .boundingBox();
  const target = await page.locator('[data-testid="model-relay-card"]').nth(1).boundingBox();
  assert.ok(handle && target, "拖拽把手与目标卡片均可见");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  const endY = target.y + target.height + 24;
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(handle.x, handle.y + ((endY - handle.y) * step) / 12);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
  assert.deepEqual(
    await page.locator('[data-testid="model-relay-card"]').evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.cardModel),
    ),
    ["MiniMax-M3", "GLM-5.4"],
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__modelRelayStore.writes
          .at(-1)
          ?.modelRelayChain?.entries.map((entry) => entry.modelId)
          .join(","),
    ),
    "MiniMax-M3,GLM-5.4",
  );

  // 阈值滑动条：把第一张调到 30%，写入记录带新阈值。
  const slider = page.locator('[data-testid="model-relay-slider-0"]');
  await slider.fill("30");
  assert.equal(await page.locator('[data-testid="model-relay-slider-0-value"]').innerText(), "30%");
  assert.equal(
    await page.evaluate(
      () => window.__modelRelayStore.writes.at(-1)?.modelRelayChain?.entries[0]?.thresholdPercent,
    ),
    30,
  );

  // 删除卡片：只剩一张，出现「少于 2 张不生效」提示。
  await page.locator('[data-testid="model-relay-remove-0"]').click();
  assert.equal(await page.locator('[data-testid="model-relay-card"]').count(), 1);
  assert.equal(await page.locator('[data-testid="model-relay-inactive-hint"]').count(), 1);

  // 添加模型：对话框只列 5 小时额度可读的供应商；已在链路里的模型被过滤。
  // 上一步删除的是拖到首位的 MiniMax-M3，所以它重新可加，而 GLM-5.4 仍在链路里。
  await page.locator('[data-testid="model-relay-add"]').click();
  await page.waitForSelector('[data-testid="model-relay-add-groups"]');
  assert.equal(await page.locator('[data-testid="model-relay-add-model-GLM-5.3"]').count(), 1);
  assert.equal(await page.locator('[data-testid="model-relay-add-model-GLM-5.4"]').count(), 0);
  assert.equal(await page.locator('[data-testid="model-relay-add-model-MiniMax-M3"]').count(), 1);
  await page.locator('[data-testid="model-relay-add-model-GLM-5.3"]').click();
  assert.equal(await page.locator('[data-testid="model-relay-card"]').count(), 2);
  assert.equal(
    await page.evaluate(() => {
      const entries = window.__modelRelayStore.writes.at(-1)?.modelRelayChain?.entries;
      const last = entries?.at(-1);
      return `${last?.modelId}:${last?.thresholdPercent}`;
    }),
    "GLM-5.3:80",
  );
  assert.deepEqual(errors, []);
  await page.close();
});

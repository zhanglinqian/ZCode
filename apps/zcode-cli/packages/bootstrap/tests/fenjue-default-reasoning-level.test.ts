/**
 * Fen Jue 行为差异 D1 / D2（docs/fen-jue/behavior-deltas.md）。
 *
 * D1：默认思考档位取最低的开启档，三处默认值来源共用 resolveDefaultReasoningLevel。
 * D2：等于旧默认（最高档）的已保存默认选择一次性迁移到最低开启档，账本保证只评估一次。
 * 另有一条词表守护：真实内置配置里出现过的档位名必须在已知词表内。
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ModelConfig,
  ModelConfigRules,
  ModelOptionSpecsConfig,
  ModelPropertiesConfig,
  ProviderConfigMap,
  ProviderRegistry,
  completeNewModelSelection,
  resolveDefaultReasoningLevel,
  type ModelSelection,
  type PersonalProviderConfigRepository,
  type ProviderConfigLayerSnapshot,
} from "@zcode/provider";
import {
  FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID,
  FENJUE_MIGRATIONS_FILE_NAME,
  NodePersonalProviderConfigRepository,
  runFenjueDefaultReasoningLevelMigration,
} from "@zcode/provider-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModelCatalogPort } from "../src/app/model-catalog-port.js";
import { listRegistryBackedModels } from "../src/app/provider-registry-selection.js";
import type { ProviderRegistryModelSource } from "../src/app/provider-registry-model-runtime.js";
import { createApiKeyProviderConfig } from "./provider-config-fixtures.js";

const zcodeBuiltinProviderConfigFilePath = fileURLToPath(
  new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
);

/** Built-in 现行词汇表。上游新增档位名（尤其是关闭档的同义词）时，守护用例在这里失败。 */
const KNOWN_REASONING_LEVELS = [
  "disabled",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "enabled",
];

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fenjue-default-reasoning-level-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("D1 resolveDefaultReasoningLevel", () => {
  it.each([
    { values: ["disabled", "enabled"], expected: "enabled" },
    { values: ["none", "low", "medium", "high", "xhigh", "max"], expected: "low" },
    { values: ["disabled", "low", "medium", "high"], expected: "low" },
    { values: ["minimal", "low", "medium", "high"], expected: "minimal" },
    { values: ["low", "medium", "high"], expected: "low" },
    { values: ["disabled", "none"], expected: "disabled" },
    { values: [], expected: undefined },
  ])("取最低的开启档：$values → $expected", ({ values, expected }) => {
    expect(resolveDefaultReasoningLevel(values)).toBe(expected);
  });

  it("completeNewModelSelection 用同一条规则构造新选择", () => {
    const registry = completionView([
      { providerId: "p", modelId: "catch-all", values: ["disabled", "enabled"] },
      { providerId: "p", modelId: "gpt", values: ["none", "low", "high"] },
    ]);
    expect(completeNewModelSelection(registry, { providerId: "p", modelId: "catch-all" })).toEqual({
      providerId: "p",
      modelId: "catch-all",
      options: { reasoningLevel: "enabled" },
    });
    expect(completeNewModelSelection(registry, { providerId: "p", modelId: "gpt" })).toEqual({
      providerId: "p",
      modelId: "gpt",
      options: { reasoningLevel: "low" },
    });
    expect(
      completeNewModelSelection(registry, { providerId: "p", modelId: "missing" }),
    ).toBeUndefined();
  });

  it("CLI 模型列表与工具层模型目录给出同一个默认档位", () => {
    const values = ["none", "low", "medium", "high"];
    const registry = new ProviderRegistry([
      {
        providerId: "provider-a",
        providerName: "Provider A",
        config: createApiKeyProviderConfig({ models: ["model-a"] }),
        models: [{ modelId: "model-a", config: completeModelConfig(values) }],
      },
    ]);

    const [option] = listRegistryBackedModels(registry);
    expect(option.reasoning.defaultLevel).toBe("low");

    const port = createModelCatalogPort({
      registry: {
        getView: () => ({
          revision: 1,
          providers: [
            {
              providerId: "provider-a",
              providerName: "Provider A",
              config: {},
              models: [
                {
                  modelId: "model-a",
                  config: { optionSpecs: { reasoningLevel: { values } }, properties: {} },
                },
              ],
            },
          ],
        }),
      } as unknown as ProviderRegistryModelSource,
      currentSelection: () => undefined,
    });
    expect(port.listModels()[0]?.defaultReasoningLevel).toBe("low");
    expect(resolveDefaultReasoningLevel(values)).toBe("low");
  });

  it("词表守护：真实内置配置里的档位名都在已知词表内", async () => {
    const bundled = JSON.parse(await readFile(zcodeBuiltinProviderConfigFilePath, "utf8"));
    const levels = collectReasoningLevels(bundled);
    expect(levels.size).toBeGreaterThan(0);
    expect(levels.has("disabled")).toBe(true);
    expect([...levels].filter((level) => !KNOWN_REASONING_LEVELS.includes(level))).toEqual([]);
  });
});

describe("D2 runFenjueDefaultReasoningLevelMigration", () => {
  it("最高档被改写为最低开启档并记账；之后手动调回最高档不再被改", async () => {
    const personal = fakePersonalRepository({
      providerId: "p",
      modelId: "m",
      options: { reasoningLevel: "high" },
    });
    const options = migrationOptions(personal.repository, ["low", "medium", "high"]);

    await expect(runFenjueDefaultReasoningLevelMigration(options)).resolves.toBe("applied");
    expect(personal.current()?.options?.reasoningLevel).toBe("low");
    expect(await readAppliedMigrations(options.ledgerFilePath)).toEqual([
      FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID,
    ]);

    // 账本已有记录：不再评估，也就不会把用户之后的选择压回去。
    personal.saveDefault({ providerId: "p", modelId: "m", options: { reasoningLevel: "high" } });
    await expect(runFenjueDefaultReasoningLevelMigration(options)).resolves.toBe("skipped");
    expect(personal.current()?.options?.reasoningLevel).toBe("high");
  });

  it("关闭档在前的档位表：最高档改写到最低开启档", async () => {
    const personal = fakePersonalRepository({
      providerId: "p",
      modelId: "m",
      options: { reasoningLevel: "max" },
    });
    await expect(
      runFenjueDefaultReasoningLevelMigration(
        migrationOptions(personal.repository, ["none", "low", "high", "max"]),
      ),
    ).resolves.toBe("applied");
    expect(personal.current()?.options?.reasoningLevel).toBe("low");
  });

  it("档位不是最高档的不动，但记账", async () => {
    const personal = fakePersonalRepository({
      providerId: "p",
      modelId: "m",
      options: { reasoningLevel: "medium" },
    });
    const options = migrationOptions(personal.repository, ["low", "medium", "high"]);
    await expect(runFenjueDefaultReasoningLevelMigration(options)).resolves.toBe("unchanged");
    expect(personal.current()?.options?.reasoningLevel).toBe("medium");
    expect(await readAppliedMigrations(options.ledgerFilePath)).toEqual([
      FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID,
    ]);
  });

  it("解析不到模型时不改写也不记账，下次再试", async () => {
    const personal = fakePersonalRepository({
      providerId: "p",
      modelId: "m",
      options: { reasoningLevel: "high" },
    });
    const options = migrationOptions(personal.repository, undefined);
    await expect(runFenjueDefaultReasoningLevelMigration(options)).resolves.toBe("pending");
    expect(personal.current()?.options?.reasoningLevel).toBe("high");
    await expect(readFile(options.ledgerFilePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    // 模型之后能解析到了，同一份配置照常迁移。
    await expect(
      runFenjueDefaultReasoningLevelMigration(migrationOptions(personal.repository, ["low", "high"])),
    ).resolves.toBe("applied");
    expect(personal.current()?.options?.reasoningLevel).toBe("low");
  });

  it("没有默认选择时只记账", async () => {
    const personal = fakePersonalRepository(undefined);
    const options = migrationOptions(personal.repository, ["low", "high"]);
    await expect(runFenjueDefaultReasoningLevelMigration(options)).resolves.toBe("unchanged");
    expect(personal.current()).toBeUndefined();
    expect(await readAppliedMigrations(options.ledgerFilePath)).toEqual([
      FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID,
    ]);
  });

  it("读与写之间默认选择被他人改动时放弃本轮，不记账", async () => {
    const personal = fakePersonalRepository({
      providerId: "p",
      modelId: "m",
      options: { reasoningLevel: "high" },
    });
    personal.interfereBeforeUpdate({ providerId: "p", modelId: "other", options: {} });
    const options = migrationOptions(personal.repository, ["low", "high"]);
    await expect(runFenjueDefaultReasoningLevelMigration(options)).resolves.toBe("pending");
    expect(personal.current()?.modelId).toBe("other");
    await expect(readFile(options.ledgerFilePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("用真实的个人配置仓库走一遍写回", async () => {
    const repository = new NodePersonalProviderConfigRepository({
      filePath: join(directory, "provider_config.json"),
      pollingIntervalMs: false,
    });
    try {
      await repository.update(() => ({
        providers: ProviderConfigMap.empty(),
        models: ModelConfigRules.empty(),
        defaultModelSelection: { providerId: "p", modelId: "m", options: { reasoningLevel: "high" } },
      }));
      const result = await runFenjueDefaultReasoningLevelMigration({
        personalRepository: repository,
        ledgerFilePath: join(directory, "real", FENJUE_MIGRATIONS_FILE_NAME),
        readReasoningLevels: () => ["low", "medium", "high"],
      });
      expect(result).toBe("applied");
      expect((await repository.read()).defaultModelSelection?.options?.reasoningLevel).toBe("low");
      const persisted = JSON.parse(await readFile(join(directory, "provider_config.json"), "utf8"));
      expect(persisted.config.defaultModelSelection).toEqual({
        providerId: "p",
        modelId: "m",
        options: { reasoningLevel: "low" },
      });
    } finally {
      repository.dispose();
    }
  });
});

function migrationOptions(
  personalRepository: PersonalProviderConfigRepository,
  values: readonly string[] | undefined,
) {
  return {
    personalRepository,
    ledgerFilePath: join(
      directory,
      `ledger-${Math.random().toString(16).slice(2)}`,
      FENJUE_MIGRATIONS_FILE_NAME,
    ),
    readReasoningLevels: () => values,
    now: () => new Date("2026-11-28T00:00:00.000Z"),
  };
}

async function readAppliedMigrations(ledgerFilePath: string): Promise<string[]> {
  const ledger = JSON.parse(await readFile(ledgerFilePath, "utf8")) as {
    schemaVersion: number;
    applied: Record<string, string>;
  };
  expect(ledger.schemaVersion).toBe(1);
  expect(ledger.applied[FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID]).toBe(
    "2026-11-28T00:00:00.000Z",
  );
  return Object.keys(ledger.applied);
}

function completionView(
  models: ReadonlyArray<{ providerId: string; modelId: string; values: readonly string[] }>,
) {
  const providers = [...new Set(models.map((model) => model.providerId))];
  return {
    providers: providers.map((providerId) => ({
      providerId,
      models: models
        .filter((model) => model.providerId === providerId)
        .map((model) => ({
          modelId: model.modelId,
          config: { optionSpecs: { reasoningLevel: { values: model.values } } },
        })),
    })),
  };
}

function fakePersonalRepository(initial: ModelSelection | undefined) {
  let snapshot = snapshotOf(initial);
  let beforeUpdate: (() => void) | undefined;
  const repository: PersonalProviderConfigRepository = {
    async read() {
      return snapshot;
    },
    onDidChange: () => () => {},
    async update(transform) {
      beforeUpdate?.();
      beforeUpdate = undefined;
      snapshot = snapshotOf(transform(snapshot).defaultModelSelection);
      return snapshot;
    },
  };
  return {
    repository,
    current: () => snapshot.defaultModelSelection,
    saveDefault(selection: ModelSelection | undefined) {
      snapshot = snapshotOf(selection);
    },
    /** 模拟迁移读完之后、拿到配置锁之前，另一个写入者改了默认选择。 */
    interfereBeforeUpdate(selection: ModelSelection) {
      beforeUpdate = () => {
        snapshot = snapshotOf(selection);
      };
    },
  };
}

function snapshotOf(defaultModelSelection: ModelSelection | undefined): ProviderConfigLayerSnapshot {
  return {
    revision: "personal-test",
    providers: ProviderConfigMap.empty(),
    models: ModelConfigRules.empty(),
    defaultModelSelection,
  };
}

function collectReasoningLevels(node: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectReasoningLevels(item, into);
    return into;
  }
  if (typeof node !== "object" || node === null) return into;
  const record = node as Record<string, unknown>;
  const values = (record.reasoningLevel as { values?: unknown } | undefined)?.values;
  if (Array.isArray(values)) {
    for (const value of values) if (typeof value === "string") into.add(value);
  }
  for (const child of Object.values(record)) collectReasoningLevels(child, into);
  return into;
}

function completeModelConfig(values: readonly string[]): ModelConfig {
  return new ModelConfig({
    properties: new ModelPropertiesConfig({
      requiresMfjsToolSchema: false,
      contextWindow: 128_000,
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: true,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: false,
    }),
    optionSpecs: new ModelOptionSpecsConfig({
      reasoningLevel: {
        values,
        map: '{"reasoning_effort":reasoningLevel}',
      },
      maxOutputTokens: {
        max: 32_000,
        map: '{"max_completion_tokens":maxOutputTokens}',
      },
    }),
  });
}

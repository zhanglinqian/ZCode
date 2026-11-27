import type { CreateAiSdkModelOptions } from "@zcode/adapters/model";
import type { Model } from "@zcode/contracts";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiKeyAccessConfig,
  ModelConfigRules,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
  ProviderRegistry,
  ZhipuAccountAccessConfig,
  type ProviderId,
} from "@zcode/provider";
import {
  NodeZCodeBuiltinProviderConfigSource,
  decodeZCodeBuiltinRelease,
  type ZCodeBuiltinProviderConfigSnapshot,
} from "@zcode/provider-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiProviderModelRuntime } from "../src/app/provider-registry-model-runtime.js";

const zcodeBuiltinProviderConfigFilePath = fileURLToPath(
  new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
);
const source = new NodeZCodeBuiltinProviderConfigSource({
  bundledFilePath: zcodeBuiltinProviderConfigFilePath,
  watch: false,
});
let zcodeBuiltin: ZCodeBuiltinProviderConfigSnapshot;

describe("Bundled GPT overrides survive newer remote releases", () => {
  it("materializes, refreshes and reopens the same effective rules for Host and Worker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fenjue-gpt-release-"));
    const activeFilePath = join(directory, "active.json");
    const bundled = JSON.parse(await readFile(zcodeBuiltinProviderConfigFilePath, "utf8"));
    const remote = structuredClone(bundled);
    delete remote.config.modelConfigOverrides;
    remote.revision = 48;
    remote.config.modelConfigRules.templateModelRules.push({
      templateId: "fixture",
      modelId: "gpt-6.2-sol",
      config: { optionSpecs: { reasoningLevel: { values: ["disabled", "enabled"], map: "{}" } } },
    });
    await writeFile(activeFilePath, JSON.stringify(remote));
    const host = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: zcodeBuiltinProviderConfigFilePath,
      activeFilePath,
      watch: false,
    });
    const resolveGpt = (snapshot: ZCodeBuiltinProviderConfigSnapshot) =>
      snapshot.models
        .resolve({
          providerId: "isolated",
          templateId: "fixture",
          modelId: "gpt-6.2-sol",
          apiType: "openai-responses",
        })
        .toJSON().optionSpecs?.reasoningLevel;
    try {
      const first = await host.read();
      expect(resolveGpt(first)).toEqual({
        values: ["low", "medium", "high", "xhigh", "max"],
        map: '{"reasoning": {"effort": reasoningLevel}}',
      });
      for (const revision of [49, 50]) {
        remote.revision = revision;
        remote.config.modelConfigRules.modelRules.push({
          modelMatch: "^unrelated-model$",
          config: { properties: { contextWindow: revision * 1000 } },
        });
        // 恶意/陈旧远端同名字段不能取得包内专项层的所有权。
        remote.config.modelConfigOverrides = {
          modelRules: [],
          modelApiRules: [],
          providerSiteRules: [],
          templateModelRules: [],
          builtinProviderModelRules: [],
        };
        const decoded = decodeZCodeBuiltinRelease(remote);
        expect(await host.applyRemoteRelease(decoded)).toBe("updated");
        expect(await host.applyRemoteRelease(decoded)).toBe("unchanged");
        const refreshed = await host.read();
        expect(resolveGpt(refreshed)).toEqual(resolveGpt(first));
        expect(
          refreshed.models.resolve({ providerId: "isolated", modelId: "unrelated-model" }).toJSON()
            .properties?.contextWindow,
        ).toBe(revision * 1000);
      }
      const materialized = await readFile(activeFilePath, "utf8");
      const worker = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: activeFilePath,
        watch: false,
      });
      const restartedHost = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: zcodeBuiltinProviderConfigFilePath,
        activeFilePath,
        watch: false,
      });
      try {
        expect(resolveGpt(await worker.read())).toEqual(resolveGpt(first));
        expect(resolveGpt(await restartedHost.read())).toEqual(resolveGpt(first));
        expect(await readFile(activeFilePath, "utf8")).toBe(materialized);
      } finally {
        worker.dispose();
        restartedHost.dispose();
      }
      // 不带专项层的旧包仍保持官方最新版选择语义，不继承前一安装包的覆盖。
      const plainBundle = join(directory, "plain.json");
      delete remote.config.modelConfigOverrides;
      remote.revision = 45;
      await writeFile(plainBundle, JSON.stringify(remote));
      const plain = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: plainBundle,
        activeFilePath,
        watch: false,
      });
      try {
        expect(resolveGpt(await plain.read())?.values).toEqual(["disabled", "enabled"]);
      } finally {
        plain.dispose();
      }
    } finally {
      host.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Bundled 缺失时不擦除 Active 已存专项层", () => {
  it("Bundled 路径不可读时快照仍带两层专项层且 Active 内容不被降级改写", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fenjue-bundled-missing-"));
    const activeFilePath = join(directory, "active.json");
    const bundled = JSON.parse(await readFile(zcodeBuiltinProviderConfigFilePath, "utf8"));
    // Active 取健康物化后的形态：远端更高 revision + 包内专项层保留。
    const materialized = structuredClone(bundled);
    materialized.revision = 48;
    const materializedText = JSON.stringify(materialized);
    await writeFile(activeFilePath, materializedText);
    const missingBundled = join(directory, "missing-bundled.json");
    const orphan = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: missingBundled,
      activeFilePath,
      watch: false,
    });
    try {
      const snapshot = await orphan.read();
      // revision 第 4 段 overrides 指纹必须存在（zcode-builtin:<rev>:<source>:<overrides>）。
      expect(snapshot.revision.split(":")).toHaveLength(4);
      expect(
        snapshot.models
          .resolve({ providerId: "isolated", modelId: "gpt-6.2-sol", apiType: "openai-responses" })
          .toJSON().optionSpecs?.reasoningLevel?.values,
      ).toEqual(["low", "medium", "high", "xhigh", "max"]);
      // 模板专项层同样保留：OpenAI 模板里仍有 fork 声明的两个模型。
      expect(
        snapshot.providerTemplates?.get("openai" as never)?.config.builtinModelIds?.slice(0, 2),
      ).toEqual(["gpt-6.2-astra", "gpt-6.2-sol"]);
      expect(await readFile(activeFilePath, "utf8")).toBe(materializedText);
    } finally {
      orphan.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Bundled 模板专项层在更高版本官方 release 上保留", () => {
  const openaiModelIds = (snapshot: ZCodeBuiltinProviderConfigSnapshot) =>
    snapshot.providerTemplates?.get("openai" as never)?.config.builtinModelIds;
  const openaiOfficialIds = (release: { config: { providerConfigRules: { templateRules: Array<{ templateId: string; config: { builtinModelIds?: string[] } }> } } }) =>
    release.config.providerConfigRules.templateRules.find((rule) => rule.templateId === "openai")
      ?.config.builtinModelIds;
  const withOpenAiOfficialIds = (release: Record<string, any>, modelIds: string[]) => {
    release.config.providerConfigRules.templateRules.find(
      (rule: { templateId: string }) => rule.templateId === "openai",
    ).config.builtinModelIds = modelIds;
    return release;
  };

  it("官方层保持原样，声明的模型插入模板，Host 与 Worker 一致，重复刷新幂等", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fenjue-template-overrides-"));
    const activeFilePath = join(directory, "active.json");
    const bundled = JSON.parse(await readFile(zcodeBuiltinProviderConfigFilePath, "utf8"));
    // 官方 release 不带任何专项层，模板官方列表里也没有 fork 声明的模型。
    const remote = withOpenAiOfficialIds(structuredClone(bundled), ["official-a", "official-b"]);
    delete remote.config.providerConfigOverrides;
    delete remote.config.modelConfigOverrides;
    remote.revision = 48;
    await writeFile(activeFilePath, JSON.stringify(remote));
    const host = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: zcodeBuiltinProviderConfigFilePath,
      activeFilePath,
      watch: false,
    });
    const expectedAfterRefresh = ["gpt-6.2-astra", "official-c", "gpt-6.2-sol", "official-a"];
    try {
      expect(openaiModelIds(await host.read())).toEqual([
        "gpt-6.2-astra",
        "gpt-6.2-sol",
        "official-a",
        "official-b",
      ]);

      // 官方在更高 revision 里自己收录了其中一个模型：不重复，另一个仍插在最前。
      remote.revision = 49;
      withOpenAiOfficialIds(remote, ["official-c", "gpt-6.2-sol", "official-a"]);
      const decoded = decodeZCodeBuiltinRelease(remote);
      expect(await host.applyRemoteRelease(decoded)).toBe("updated");
      expect(await host.applyRemoteRelease(decoded)).toBe("unchanged");
      expect(openaiModelIds(await host.read())).toEqual(expectedAfterRefresh);

      // 合并结果不写进 Active 的官方列表：Active 里官方层是官方原样，另存两块专项层。
      const materializedText = await readFile(activeFilePath, "utf8");
      const materialized = JSON.parse(materializedText);
      expect(openaiOfficialIds(materialized)).toEqual(["official-c", "gpt-6.2-sol", "official-a"]);
      expect(materialized.config.providerConfigOverrides.templateRules[0].builtinModelIds).toEqual([
        "gpt-6.2-astra",
        "gpt-6.2-sol",
      ]);
      expect(materialized.config.modelConfigOverrides).toBeDefined();

      const worker = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: activeFilePath,
        watch: false,
      });
      const restartedHost = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: zcodeBuiltinProviderConfigFilePath,
        activeFilePath,
        watch: false,
      });
      try {
        expect(openaiModelIds(await worker.read())).toEqual(expectedAfterRefresh);
        expect(openaiModelIds(await restartedHost.read())).toEqual(expectedAfterRefresh);
        expect((await worker.read()).revision).toBe((await restartedHost.read()).revision);
        expect(await readFile(activeFilePath, "utf8")).toBe(materializedText);
      } finally {
        worker.dispose();
        restartedHost.dispose();
      }

      // 换回不带专项层的包：声明消失，官方列表完好。
      const plainBundle = join(directory, "plain.json");
      await writeFile(plainBundle, JSON.stringify(remote));
      const plain = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: plainBundle,
        activeFilePath,
        watch: false,
      });
      try {
        expect(openaiModelIds(await plain.read())).toEqual([
          "official-c",
          "gpt-6.2-sol",
          "official-a",
        ]);
      } finally {
        plain.dispose();
      }
    } finally {
      host.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("只改模板层声明时快照 revision 仍然变化", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fenjue-template-fingerprint-"));
    const bundled = JSON.parse(await readFile(zcodeBuiltinProviderConfigFilePath, "utf8"));
    const withoutTemplateOverride = structuredClone(bundled);
    delete withoutTemplateOverride.config.providerConfigOverrides;
    const fewerModels = structuredClone(bundled);
    fewerModels.config.providerConfigOverrides.templateRules[0].builtinModelIds = ["gpt-6.2-astra"];
    const variants = { withoutTemplateOverride, fewerModels, bundled };
    const revisions = new Set<string>();
    try {
      for (const [name, release] of Object.entries(variants)) {
        const filePath = join(directory, `${name}.json`);
        await writeFile(filePath, JSON.stringify(release));
        const source = new NodeZCodeBuiltinProviderConfigSource({
          bundledFilePath: filePath,
          watch: false,
        });
        try {
          const snapshot = await source.read();
          revisions.add(snapshot.revision);
          expect(openaiModelIds(snapshot)?.filter((modelId) => modelId.includes("gpt-6.2"))).toEqual(
            name === "bundled"
              ? ["gpt-6.2-astra", "gpt-6.2-sol"]
              : name === "fewerModels"
                ? ["gpt-6.2-astra"]
                : [],
          );
        } finally {
          source.dispose();
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(revisions.size).toBe(3);
  });

  it.each([
    ["templateId 重复", { templateRules: [{ templateId: "a", builtinModelIds: ["x"] }, { templateId: "a", builtinModelIds: ["y"] }] }],
    ["builtinModelIds 重复", { templateRules: [{ templateId: "a", builtinModelIds: ["x", "x"] }] }],
    ["at 非法", { templateRules: [{ templateId: "a", builtinModelIds: ["x"], at: "middle" }] }],
    ["builtinModelIds 为空", { templateRules: [{ templateId: "a", builtinModelIds: [] }] }],
    ["未知字段", { templateRules: [{ templateId: "a", builtinModelIds: ["x"], extra: 1 }] }],
  ])("非法的模板专项层声明被整份 release 拒绝：%s", async (_label, providerConfigOverrides) => {
    const bundled = JSON.parse(await readFile(zcodeBuiltinProviderConfigFilePath, "utf8"));
    expect(() =>
      decodeZCodeBuiltinRelease({
        ...bundled,
        config: { ...bundled.config, providerConfigOverrides },
      }),
    ).toThrow();
  });
});

beforeAll(async () => {
  zcodeBuiltin = await source.read();
});

afterAll(() => source.dispose());

describe("真实 ZCode Built-in Config 到 Active Model", () => {
  it("API Key Personal Overlay 经 Registry 原样装配到 Adapter", () => {
    const providerId = "zai-api";
    const modelId = "glm-5.3";
    const registry = resolveOneBuiltinProvider(providerId, {
      personalProviders: new ProviderConfigMap([
        [
          providerId,
          // 实例在创建时复制模板；Resolver 不会从已退场的 templateId 字段隐式继承。
          zcodeBuiltin.providerTemplates
            .get("zai-api")!
            .config.withPersonalModelIds([modelId])
            .overlay(
              new ProviderConfig({
                group: "standard-personal",
                access: new ApiKeyAccessConfig({ apiKey: "test-zai-api-key" }),
              }),
            ),
        ],
      ]),
    });
    const capture = captureRuntime(registry);

    const model = capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
    });
    const registryProvider = registry.getProvider(providerId);
    const registryModel = registry.getModel(providerId, modelId);

    expect(model).toBe(capture.models[0]);
    expect(capture.created[0]?.providerConfig).toBe(registryProvider?.config);
    expect(capture.created[0]?.modelConfig).toBe(registryModel?.config);
    expect(capture.created[0]).toMatchObject({
      providerId,
      modelId,
      providerConfig: {
        access: { type: "api-key", apiKey: "test-zai-api-key" },
        api: {
          type: zcodeBuiltin.providerTemplates.get("zai-api")?.config.api?.type,
          baseUrl: zcodeBuiltin.providerTemplates.get("zai-api")?.config.api?.baseUrl,
        },
      },
    });
  });

  it("Account 约束 Built-in 成员后仍由 Personal Overlay 最后覆盖", () => {
    const providerId = "account:zai-start-plan";
    const modelId = "GLM-5.2";
    const registry = resolveOneBuiltinProvider(providerId, {
      accountProviders: new ProviderConfigMap([
        [
          providerId,
          new ProviderConfig({
            builtinModelIds: [modelId],
            access: new ZhipuAccountAccessConfig({ entitled: true }),
          }),
        ],
      ]),
      personalProviders: new ProviderConfigMap([
        [providerId, new ProviderConfig({ visibility: "hidden" })],
      ]),
    });
    const capture = captureRuntime(registry);

    capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
    });

    expect(registry.getProvider(providerId)?.models.map(({ modelId: id }) => id)).toEqual([
      modelId,
    ]);
    expect(capture.created[0]?.providerConfig).toMatchObject({
      visibility: "hidden",
      access: {
        type: "zhipu-account",
        accountType: "zai",
        mode: "start-plan",
      },
    });
    expect(capture.created[0]?.modelConfig).toBe(registry.getModel(providerId, modelId)?.config);
  });

  it("隐藏 Request Auth Provider 仍由普通 Registry 精确创建 Model", () => {
    const providerId = "account:zai-offpeak-idle-plan";
    const modelId = "GLM-5.3";
    const registry = resolveOneBuiltinProvider(providerId, {
      accountProviders: new ProviderConfigMap([
        [
          providerId,
          new ProviderConfig({
            access: new ZhipuAccountAccessConfig({ entitled: true }),
          }),
        ],
      ]),
    });
    const capture = captureRuntime(registry);
    const requestAuthSource = { resolve: vi.fn() };

    capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
      requestDependencies: { requestAuth: { source: requestAuthSource } },
    });

    expect(registry.getView().providers[0]).toMatchObject({
      providerId,
      config: {
        visibility: "hidden",
        access: { type: "zhipu-account", accountType: "zai", mode: "off-peak" },
      },
    });
    expect(capture.created[0]?.requestDependencies?.requestAuth?.source).toBe(requestAuthSource);
    expect(capture.created[0]?.providerConfig).toBe(registry.getProvider(providerId)?.config);
    expect(capture.created[0]?.modelConfig).toBe(registry.getModel(providerId, modelId)?.config);
  });
});

function selectionWithHighestReasoning(
  registry: ProviderRegistry,
  providerId: ProviderId,
  modelId: string,
) {
  const reasoningLevel = registry
    .getModel(providerId, modelId)
    ?.config.optionSpecs.reasoningLevel.values.at(-1);
  if (!reasoningLevel) throw new Error(`测试模型缺少 reasoning: ${providerId}/${modelId}`);
  return { providerId, modelId, options: { reasoningLevel } };
}

function resolveOneBuiltinProvider(
  providerId: ProviderId,
  overlays: {
    accountProviders?: ProviderConfigMap;
    personalProviders?: ProviderConfigMap;
    models?: ModelConfigRules;
  } = {},
): ProviderRegistry {
  const provider = zcodeBuiltin.providers.get(providerId);
  const personalProvider = overlays.personalProviders?.get(providerId);
  if (!provider && !personalProvider) {
    throw new Error(`测试引用的 Built-in Provider 或 Personal 实例不存在: ${providerId}`);
  }
  const resolution = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: provider
      ? new ProviderConfigMap([[providerId, provider]])
      : ProviderConfigMap.empty(),
    zcodeBuiltinProviderTemplates: zcodeBuiltin.providerTemplates,
    accountProviders: overlays.accountProviders ?? ProviderConfigMap.empty(),
    personalProviders: overlays.personalProviders ?? ProviderConfigMap.empty(),
    zcodeBuiltinModelRules: zcodeBuiltin.models,
    personalModels: overlays.models ?? ModelConfigRules.empty(),
  });
  expect(resolution.issues).toEqual([]);
  return new ProviderRegistry(resolution.registryProviders);
}

function captureRuntime(registry: ProviderRegistry) {
  const created: CreateAiSdkModelOptions[] = [];
  const models: Model[] = [];
  const runtime = new ApiProviderModelRuntime({
    registry: {
      getView: () => registry.getView(),
      getProvider: (providerId) => registry.getProvider(providerId),
      getModel: (providerId, modelId) => registry.getModel(providerId, modelId),
      validateSelection: (selection) => registry.validateSelection(selection),
      onDidChange: (listener) => registry.onDidChange(listener),
    },
    modelAdapter: {
      createModel(options) {
        created.push(options);
        const model = createCapturedModel(options);
        models.push(model);
        return model;
      },
    },
  });
  runtime.start();
  return { created, models, runtime };
}

function createCapturedModel(options: CreateAiSdkModelOptions): Model {
  const model: Model = {
    providerId: options.providerId,
    modelId: options.modelId,
    properties: options.modelConfig.properties,
    optionSpecs: options.modelConfig.optionSpecs,
    options: options.options,
    bind() {
      return model;
    },
    async generateText() {
      throw new Error("not used");
    },
    streamText() {
      throw new Error("not used");
    },
  };
  return model;
}

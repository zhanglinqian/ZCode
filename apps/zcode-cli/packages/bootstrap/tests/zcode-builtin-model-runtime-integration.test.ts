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

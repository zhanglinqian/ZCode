import {
  validateModelSelectionOptions,
  type ModelSelection,
  type ProviderRegistryView,
} from "./registry.js";

export type InitialModelSelectionResolution =
  | {
      readonly source: "configured-default" | "registry-fallback";
      readonly selection: ModelSelection;
    }
  | { readonly source: "none" };

interface ModelSelectionCompletionView {
  readonly providers: readonly {
    readonly providerId: string;
    readonly models: readonly {
      readonly modelId: string;
      readonly config: {
        readonly optionSpecs: {
          readonly reasoningLevel: { readonly values: readonly string[] };
        };
      };
    }[];
  }[];
}

export function resolveInitialModelSelection(input: {
  readonly configuredDefault?: ModelSelection;
  readonly registry: ProviderRegistryView;
}): InitialModelSelectionResolution {
  // 这里只构造 Host 的初始推荐，不解析已有会话意图。失效默认是可丢弃偏好，
  // 应继续按 Registry 顺序推荐；不能把历史选择留空的规则误用于新草稿初始化。
  if (input.configuredDefault) {
    if (isSelectable(input.registry, input.configuredDefault)) {
      return {
        source: "configured-default",
        selection: freezeSelection(input.configuredDefault),
      };
    }
  }

  // 仅用于全新草稿的 Host 初始推荐；历史未绑定状态不能进入这个初始化分支。
  for (const provider of input.registry.providers) {
    if (provider.config.visibility === "hidden") continue;
    for (const model of provider.models) {
      const selection = completeNewModelSelection(input.registry, {
        providerId: provider.providerId,
        modelId: model.modelId,
      });
      if (selection) return { source: "registry-fallback", selection: freezeSelection(selection) };
    }
  }
  return { source: "none" };
}

/**
 * 不产出思考的档位名。档位表 values 是开放字符串，关闭档没有统一命名（历史上出现过
 * off / nothink，现行官方层用 disabled、GPT 系用 none），只能按 Built-in 现行词汇表登记；
 * 上游新增同义名时，词表守护用例会失败（见 docs/fen-jue/behavior-deltas.md D1）。
 */
const NON_THINKING_REASONING_LEVELS: ReadonlySet<string> = new Set(["disabled", "none"]);

/**
 * 新选择与一次性迁移共用的默认档位规则：取最低的开启档。
 *
 * Fen Jue 行为差异（docs/fen-jue/behavior-deltas.md D1）：上游把 values.at(-1)（最高档）
 * 当作默认，新选模型就按最高强度消耗额度与等待时间。这里跳过 disabled / none 这类
 * 关闭档，避免默认落到不思考；全是关闭档时取首项，保证一定有默认值。
 * CLI 模型列表与工具层模型目录的默认值也必须走这个函数，不能各自取值。
 */
export function resolveDefaultReasoningLevel(values: readonly string[]): string | undefined {
  return values.find((level) => !NON_THINKING_REASONING_LEVELS.has(level)) ?? values[0];
}

/** 仅在用户主动选模型或全新初始化时构造默认档位；不能用于恢复/重解析已有选择。 */
export function completeNewModelSelection(
  registry: ModelSelectionCompletionView,
  selection: ModelSelection,
): ModelSelection | undefined {
  const model = registry.providers
    .find((provider) => provider.providerId === selection.providerId)
    ?.models.find((candidate) => candidate.modelId === selection.modelId);
  const reasoningLevel = resolveDefaultReasoningLevel(
    model?.config.optionSpecs.reasoningLevel.values ?? [],
  );
  if (!reasoningLevel) return undefined;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    options: { reasoningLevel },
  };
}

/**
 * 规范化一份待提交的 Selection。
 * 已有选择缺失或失效时只保留模型身份，等待用户选择档位；主动选模型另走 completion。
 * 任何执行入口都必须在此之后再次确认 Selection 完整，不能静默补档位。
 */
export function normalizeModelSelection(
  registry: ModelSelectionCompletionView,
  selection: ModelSelection,
): ModelSelection | undefined {
  const model = registry.providers
    .find((provider) => provider.providerId === selection.providerId)
    ?.models.find((candidate) => candidate.modelId === selection.modelId);
  if (!model) return undefined;
  const values = model.config.optionSpecs.reasoningLevel.values;
  const reasoningLevel = selection.options?.reasoningLevel;
  if (reasoningLevel !== undefined && values.includes(reasoningLevel)) return selection;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
  };
}

function isSelectable(registry: ProviderRegistryView, selection: ModelSelection): boolean {
  const provider = registry.providers.find(
    (candidate) => candidate.providerId === selection.providerId,
  );
  if (provider?.config.visibility === "hidden") return false;
  const model = provider?.models.find((candidate) => candidate.modelId === selection.modelId);
  if (!model) return false;
  return validateModelSelectionOptions(model, selection).ok;
}

function freezeSelection(selection: ModelSelection): ModelSelection {
  return Object.freeze({
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.options ? { options: Object.freeze({ ...selection.options }) } : {}),
  });
}

import { z } from "zod";
import {
  parseZCodeBuiltinModelConfigRules,
  parseZCodeBuiltinProviderConfigRules,
  type ModelConfigRules,
  type ProviderConfigMap,
  type ProviderTemplateMap,
} from "@zcode/provider";

export const ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION = 1 as const;
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

/** 模板模型插入位置：补在官方列表之前或之后。 */
export type ProviderTemplateModelInsertPosition = "start" | "end";

/** 包内专项的模板模型插入：只向该模板的 builtinModelIds 补 ID，不替换官方列表。 */
export interface ProviderTemplateConfigOverride {
  readonly templateId: string;
  readonly builtinModelIds: readonly string[];
  readonly at: ProviderTemplateModelInsertPosition;
}

/** 包内专项模板层；Source 只信任当前 Bundled 提供的这一层。 */
export interface ProviderConfigOverrides {
  readonly templateRules: readonly ProviderTemplateConfigOverride[];
}

export interface ZCodeBuiltinConfigContent {
  readonly providers: ProviderConfigMap;
  readonly providerTemplates: ProviderTemplateMap;
  readonly modelConfigRules: ModelConfigRules;
  /** 包内专项模型规则；Source 只信任当前 Bundled 提供的这一层。 */
  readonly modelConfigOverrides?: ModelConfigRules;
  /** 包内专项模板层；Source 只信任当前 Bundled 提供的这一层。 */
  readonly providerConfigOverrides?: ProviderConfigOverrides;
}

export interface ZCodeBuiltinRelease {
  readonly schemaVersion: typeof ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION;
  readonly revision: number;
  readonly config: ZCodeBuiltinConfigContent;
}

const providerConfigOverridesSchema = z
  .object({
    templateRules: z
      .array(
        z
          .object({
            templateId: z.string().trim().min(1),
            builtinModelIds: z.array(z.string().trim().min(1)).min(1),
            at: z.enum(["start", "end"]).default("end"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((overrides, context) => {
    const templateIds = new Set<string>();
    overrides.templateRules.forEach((rule, index) => {
      if (templateIds.has(rule.templateId)) {
        context.addIssue({
          code: "custom",
          path: ["templateRules", index, "templateId"],
          message: `专项模板层 templateId 重复: ${rule.templateId}`,
        });
      }
      templateIds.add(rule.templateId);
      if (new Set(rule.builtinModelIds).size !== rule.builtinModelIds.length) {
        context.addIssue({
          code: "custom",
          path: ["templateRules", index, "builtinModelIds"],
          message: `专项模板层 builtinModelIds 重复: ${rule.templateId}`,
        });
      }
    });
  });

const releaseSchema = z
  .object({
    schemaVersion: z.literal(ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    config: z
      .object({
        providerConfigRules: z.unknown(),
        modelConfigRules: z.unknown(),
        modelConfigOverrides: z.unknown().optional(),
        providerConfigOverrides: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export function decodeZCodeBuiltinRelease(input: unknown): ZCodeBuiltinRelease {
  const parsed = releaseSchema.parse(input);
  const { providers, providerTemplates } = parseZCodeBuiltinProviderConfigRules(
    parsed.config.providerConfigRules,
  );
  // ZAPI 已退出产品，旧 Remote Release 或 LKG 不能在 Renderer 静态入口删除后
  // 又通过目标 Host Registry 将它重新发布。拒绝整份不兼容 Release，让 Source 回落到兼容候选。
  if (providers.has(RETIRED_ZAPI_PROVIDER_ID)) {
    throw new Error(`ZCode Built-in Release 包含已退出的 Provider: ${RETIRED_ZAPI_PROVIDER_ID}`);
  }
  return Object.freeze({
    schemaVersion: ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: parsed.revision,
    config: Object.freeze({
      providers,
      providerTemplates,
      modelConfigRules: parseZCodeBuiltinModelConfigRules(parsed.config.modelConfigRules),
      ...(parsed.config.modelConfigOverrides === undefined
        ? {}
        : {
            modelConfigOverrides: parseZCodeBuiltinModelConfigRules(
              parsed.config.modelConfigOverrides,
            ),
          }),
      ...(parsed.config.providerConfigOverrides === undefined
        ? {}
        : {
            providerConfigOverrides: parseZCodeBuiltinProviderConfigOverrides(
              parsed.config.providerConfigOverrides,
            ),
          }),
    }),
  });
}

export function parseZCodeBuiltinProviderConfigOverrides(input: unknown): ProviderConfigOverrides {
  const parsed = providerConfigOverridesSchema.parse(input);
  return Object.freeze({
    templateRules: Object.freeze(
      parsed.templateRules.map((rule) =>
        Object.freeze({
          templateId: rule.templateId,
          builtinModelIds: Object.freeze([...rule.builtinModelIds]),
          at: rule.at,
        }),
      ),
    ),
  });
}

export function encodeProviderConfigOverrides(overrides: ProviderConfigOverrides): object {
  return {
    templateRules: overrides.templateRules.map((rule) => ({
      templateId: rule.templateId,
      builtinModelIds: [...rule.builtinModelIds],
      at: rule.at,
    })),
  };
}

export function encodeZCodeBuiltinRelease(release: ZCodeBuiltinRelease): object {
  return {
    schemaVersion: ZCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: release.revision,
    config: {
      providerConfigRules: {
        templateRules: release.config.providerTemplates.toJSON(),
        providerRules: release.config.providers.toJSON(),
      },
      modelConfigRules: release.config.modelConfigRules.toZCodeBuiltinJSON(),
      ...(release.config.modelConfigOverrides === undefined
        ? {}
        : { modelConfigOverrides: release.config.modelConfigOverrides.toZCodeBuiltinJSON() }),
      ...(release.config.providerConfigOverrides === undefined
        ? {}
        : {
            providerConfigOverrides: encodeProviderConfigOverrides(
              release.config.providerConfigOverrides,
            ),
          }),
    },
  };
}

export function serializeZCodeBuiltinRelease(release: ZCodeBuiltinRelease): string {
  return JSON.stringify(encodeZCodeBuiltinRelease(release));
}

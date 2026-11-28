/**
 * 模型接力的纯领域逻辑（docs/fen-jue/model-relay.md）。
 *
 * 只放类型、校验与纯函数：不做任何 IO，不依赖产品身份。Host 的 model-relay
 * 模块负责额度读取与切换执行；这里只回答「下一个可用模型是谁、该不该切」。
 */
import { z } from "zod";
import type { UsageQuotaLimit } from "./usage-quota.js";

/** 链路中的一张卡片：模型身份加已用额度阈值（百分比，0–100）。 */
export interface ModelRelayEntry {
  readonly providerId: string;
  readonly modelId: string;
  readonly thresholdPercent: number;
}

export const modelRelayChainSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            providerId: z.string().trim().min(1),
            modelId: z.string().trim().min(1),
            thresholdPercent: z.number().min(0).max(100),
          })
          .strict(),
      )
      .max(16),
  })
  .strict()
  .superRefine((chain, context) => {
    const seen = new Set<string>();
    chain.entries.forEach((entry, index) => {
      const key = `${entry.providerId}/${entry.modelId}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index],
          message: `链路中模型重复: ${key}`,
        });
      }
      seen.add(key);
    });
  });

export type ModelRelayChain = z.infer<typeof modelRelayChainSchema>;

/**
 * 从归一后的额度桶里选出 5 小时窗口。
 *
 * GLM 系是套餐级共享桶（TIME_LIMIT）；MiniMax 是按模型分桶（TOKENS_LIMIT，
 * unit=3 + number=5 是 5 小时窗口，unit=6 是周窗口）。找不到返回 null，
 * 表示该模型本版本不参与判定。
 */
export function pickFiveHourLimit(limits: readonly UsageQuotaLimit[]): UsageQuotaLimit | null {
  const byTimeLimit = limits.find((limit) => limit.type === "TIME_LIMIT");
  if (byTimeLimit) return byTimeLimit;
  return (
    limits.find(
      (limit) => limit.type === "TOKENS_LIMIT" && limit.unit === 3 && limit.number === 5,
    ) ?? null
  );
}

/** 从 5 小时桶读已用占比；percentage 缺失时同样视为未知。 */
export function readFiveHourUsedPercent(limits: readonly UsageQuotaLimit[]): number | null {
  const limit = pickFiveHourLimit(limits);
  return typeof limit?.percentage === "number" && Number.isFinite(limit.percentage)
    ? limit.percentage
    : null;
}

/** 单张卡片的额度事实：已知已用占比，或未知（读取失败 / 无数据）。 */
export type RelayUsage =
  | { readonly known: true; readonly usedPercent: number }
  | {
      readonly known: false;
    };

export type RelayTargetResolution =
  | { readonly kind: "keep" }
  /** 切换到链路里的某张卡片；额度已知时带已用占比，未知（可用兜底）时不带。 */
  | {
      readonly kind: "switch";
      readonly entry: ModelRelayEntry;
      readonly usedPercent?: number;
    }
  /** 一圈内所有候选的已知额度都达到阈值（没有未知额度的候选可兜底）。 */
  | { readonly kind: "exhausted" };

/**
 * 接力目标决策。
 *
 * - 链路少于 2 张、当前模型不在链路内、当前模型额度未知或未达阈值：保持。
 * - 达到阈值时从下一张开始环形扫描，返回第一个「可用」的卡片：额度未知（按量付费、
 *   查询失败、无 5 小时窗口）视为可用兜底，已知额度则须低于自身阈值。
 * - 一圈里所有候选的已知额度都达阈值（且没有未知额度的候选兜底）才返回 exhausted。
 */
export function resolveRelayTarget(
  chain: readonly ModelRelayEntry[],
  current: { readonly providerId: string; readonly modelId: string },
  usageOf: (entry: ModelRelayEntry) => RelayUsage,
): RelayTargetResolution {
  if (chain.length < 2) return { kind: "keep" };
  const currentIndex = chain.findIndex(
    (entry) => entry.providerId === current.providerId && entry.modelId === current.modelId,
  );
  if (currentIndex < 0) return { kind: "keep" };
  const currentEntry = chain[currentIndex]!;
  const currentUsage = usageOf(currentEntry);
  if (!currentUsage.known || currentUsage.usedPercent < currentEntry.thresholdPercent) {
    return { kind: "keep" };
  }
  for (let step = 1; step < chain.length; step += 1) {
    const candidate = chain[(currentIndex + step) % chain.length]!;
    const usage = usageOf(candidate);
    // 额度未知（按量付费、无 5 小时窗口、查询失败）的候选视为可用：允许加入链路的
    // 模型必须也能被切到，否则"按量模型当兜底终点"不成立（产品规则 2026-11-28 调整）。
    if (!usage.known || usage.usedPercent < candidate.thresholdPercent) {
      return {
        kind: "switch",
        entry: candidate,
        ...(usage.known ? { usedPercent: usage.usedPercent } : {}),
      };
    }
  }
  return { kind: "exhausted" };
}

/**
 * 明确的额度耗尽类失败判定（报错续跑的触发条件）。
 *
 * 业务码清单与 CLI 侧 adapters 的 WORKFLOW_QUOTA_PROVIDER_CODES 同源；守护用例
 * （bootstrap 包）断言两边逐项一致，上游增减业务码时会失败。数字码走 code 精确
 * 匹配，字符串码（insufficient_quota 等）还会出现在失败消息原文里，一并做包含匹配。
 */
export const QUOTA_EXHAUSTED_CODES: ReadonlySet<string> = new Set([
  "1005",
  "1308",
  "1310",
  "1313",
  "1316",
  "1317",
  "1318",
  "1319",
  "1320",
  "1321",
  "2056",
  "20097",
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "exceeded_current_quota_error",
]);

export function isQuotaExhaustedFailure(code: string | undefined, message: string): boolean {
  if (code !== undefined && QUOTA_EXHAUSTED_CODES.has(code.trim())) return true;
  // 业务码常嵌在失败消息原文里（如「…insufficient_quota…」「[1308] 您的限额将在…重置」），做包含匹配。
  for (const quotaCode of QUOTA_EXHAUSTED_CODES) {
    if (message.includes(quotaCode)) return true;
  }
  return false;
}

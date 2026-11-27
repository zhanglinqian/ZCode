/* MiniMax 套餐（M Plan / Token Plan）额度读取（`GET /v1/token_plan/remains`）。
 *
 * 与 Z.ai / BigModel 的额度来源不同：GLM 的额度由 ZCode 服务端的
 * `zcode-plan/billing/balance` 统一下发，而 MiniMax 的额度只由 MiniMax 自己掌握，
 * 走官方 `token_plan/remains` 接口直连读取，不经过 ZCode 服务端。
 *
 * 认证用 **订阅 Key**（`sk-cp-…`）：MiniMax 的订阅 Key 与普通按量计费 API Key 是两套，
 * 互不通用。用按量 Key 调本接口会被上游拒绝，因此失败必须如实呈现，不能回退到别的数据源。
 *
 * 额度模型是「5 小时窗口 + 周窗口」双窗口，与 Coding Plan 额度卡的 5 小时 / 周两张卡对应，
 * 因此映射到现有 `UsageQuotaLimit`，复用既有展示逻辑。
 */
import { z } from "zod";
import {
  type ApiClient,
  type ApiRequestInit,
  type UsageQuotaLimit,
  type UsageQuotaUsageDetail,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";

const MINIMAX_TOKEN_PLAN_REMAINS_PATH = "/v1/token_plan/remains";
const REQUEST_TIMEOUT_MS = 15_000;
/** 响应体截断长度。实测响应约 1KB（多模型条目），放宽到 4KB 保证日志里能看到全量字段。 */
const MAX_LOGGED_BODY_CHARS = 4096;
const log = createServiceLogger("usage-stats");

/**
 * 判定 baseUrl 是否指向 MiniMax 官方额度接口。
 *
 * 按 host 判定而不是按 templateId：个人实例可以基于任意模板创建，也可能改过端点，
 * host 才是额度接口实际会去的那台机器。判定沿用
 * `resolveModelProviderFamilyIdByBaseURL` 的同款 host 匹配口径。
 */
export function isMinimaxQuotaBaseUrl(baseUrl: string | null | undefined): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return false;
  let hostname: string;
  try {
    hostname = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "api.minimaxi.com" ||
    hostname === "api.minimax.io" ||
    hostname.endsWith(".api.minimaxi.com") ||
    hostname.endsWith(".api.minimax.io")
  );
}

/**
 * MiniMax 额度接口信封。
 *
 * 字段名在不同版本与不同第三方实现里 snake_case / camelCase 都出现过（CC Switch、
 * OpenClaw、minimax-status 扩展均命中过同一组字段），因此这里两种写法都接受。
 *
 * 响应尚未用真实订阅 Key 实测，字段口径待实测后校准；因此 schema 全部 optional，
 * 由映射层按"有就用、没有就留空"处理，不让单个字段缺失把整份快照判废。
 */
const minimaxBaseRespSchema = z
  .object({
    status_code: z.number().optional(),
    statusCode: z.number().optional(),
    status_msg: z.string().optional(),
    statusMsg: z.string().optional(),
  })
  .passthrough();

const minimaxModelRemainsSchema = z
  .object({
    model_name: z.string().optional(),
    modelName: z.string().optional(),
    /** 5 小时窗口的总额次数。 */
    current_interval_total_count: z.number().optional(),
    currentIntervalTotalCount: z.number().optional(),
    /** 5 小时窗口的已用次数。 */
    current_interval_usage_count: z.number().optional(),
    currentIntervalUsageCount: z.number().optional(),
    /** 周窗口的总额次数。 */
    current_weekly_total_count: z.number().optional(),
    currentWeeklyTotalCount: z.number().optional(),
    /** 周窗口的已用次数。 */
    current_weekly_usage_count: z.number().optional(),
    currentWeeklyUsageCount: z.number().optional(),
    /**
     * 5 小时窗口的**剩余**占比（0-100）。2026-11-26 真实响应实测确认的字段名。
     * 注意语义与 ZCode 的 percentage（已用占比）相反，见 buildWindowLimit。
     */
    current_interval_remaining_percent: z.number().optional(),
    currentIntervalRemainingPercent: z.number().optional(),
    /** 周窗口的**剩余**占比（0-100）。实测确认字段；周窗口没有独立的 usage_percent。 */
    current_weekly_remaining_percent: z.number().optional(),
    currentWeeklyRemainingPercent: z.number().optional(),
    /** 旧版/兼容字段名，仅在实测字段缺失时兜底。 */
    usage_percent: z.number().optional(),
    usagePercent: z.number().optional(),
    /** 5 小时窗口起止时间（实测为毫秒）。 */
    start_time: z.number().optional(),
    startTime: z.number().optional(),
    end_time: z.number().optional(),
    endTime: z.number().optional(),
    /** 周窗口有独立的起止时间字段（实测确认），与 5 小时窗口的 end_time 不同。 */
    weekly_start_time: z.number().optional(),
    weeklyStartTime: z.number().optional(),
    weekly_end_time: z.number().optional(),
    weeklyEndTime: z.number().optional(),
  })
  .passthrough();

const minimaxTokenPlanRemainsSchema = z
  .object({
    base_resp: minimaxBaseRespSchema.optional(),
    baseResp: minimaxBaseRespSchema.optional(),
    model_remains: z.array(minimaxModelRemainsSchema).optional(),
    modelRemains: z.array(minimaxModelRemainsSchema).optional(),
  })
  .passthrough();

type MinimaxModelRemains = z.infer<typeof minimaxModelRemainsSchema>;

/** 窗口额度桶的匹配口径：TOKENS_LIMIT + unit=3/number=5 是 5 小时窗口，unit=6 是周窗口。 */
const FIVE_HOUR_LIMIT_UNIT = 3;
const FIVE_HOUR_LIMIT_NUMBER = 5;
const WEEKLY_LIMIT_UNIT = 6;

function readNumber(
  entry: MinimaxModelRemains,
  ...keys: readonly (keyof MinimaxModelRemains)[]
): number | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readString(entry: MinimaxModelRemains, ...keys: readonly (keyof MinimaxModelRemains)[]) {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * 时间戳单位归一化到毫秒。
 *
 * 接口的时间字段单位尚未实测：秒与毫秒都会出现。超过 1e11 的值只可能是毫秒
 * （秒级时间戳到 1e11 需要公元 5138 年），据此判定，避免把秒当毫秒导致重置时间显示异常。
 */
function normalizeTimestampMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value > 1e11 ? value : value * 1000;
}

/**
 * 把 MiniMax 的窗口额度映射成一条 `UsageQuotaLimit`。
 *
 * 口径转换有两处必须做对：
 * 1. **percentage 语义相反**——MiniMax 的 `current_*_remaining_percent` 是**剩余**占比
 *    （2026-11-26 真实响应实测确认），ZCode 的 `UsageQuotaLimit.percentage` 契约是
 *    **已用**占比（展示端再反转成剩余）。这里必须反转一次，否则额度条会显示成"已用 20%"。
 * 2. **优先用次数字段**——次数字段比百分比精确；只有次数缺失时才退回百分比。
 */
export function buildWindowLimit(params: {
  total?: number;
  used?: number;
  remainingPercent?: number;
  unit: number;
  number?: number;
  nextResetTime?: number;
  usageDetails: UsageQuotaUsageDetail[];
}): UsageQuotaLimit | null {
  const { total, used, remainingPercent, unit, number, nextResetTime, usageDetails } = params;
  const hasTotal = typeof total === "number" && total > 0;
  const hasUsed = typeof used === "number" && used >= 0;
  const hasPercent = typeof remainingPercent === "number" && Number.isFinite(remainingPercent);

  if (!hasTotal && !hasUsed && !hasPercent) {
    return null;
  }

  let remaining: number | undefined;
  let usedPercentage: number | undefined;
  if (hasTotal && hasUsed) {
    remaining = Math.max(0, total - used);
    usedPercentage = (used / total) * 100;
  } else if (hasTotal && hasPercent) {
    // 只有总额与剩余百分比时，反推已用。
    usedPercentage = 100 - Math.max(0, Math.min(100, remainingPercent));
    remaining = total * (1 - usedPercentage / 100);
  } else if (hasPercent) {
    usedPercentage = 100 - Math.max(0, Math.min(100, remainingPercent));
  }

  return {
    type: "TOKENS_LIMIT",
    unit,
    ...(number === undefined ? {} : { number }),
    ...(typeof used === "number" ? { usage: used } : {}),
    ...(typeof remaining === "number" ? { remaining } : {}),
    ...(usedPercentage === undefined ? {} : { percentage: usedPercentage }),
    ...(nextResetTime === undefined ? {} : { nextResetTime }),
    usageDetails,
  };
}

/**
 * 选出用于展示额度条的条目。
 *
 * 2026-11-26 真实响应实测：条目里的 `model_name` 是 `"general"`（套餐共享池，
 * 官方 FAQ 明确额度在所有工具/模型间共享），后面跟各模型条目。池化条目才是
 * 套餐总额度的权威来源，优先取它；没有再退回 MiniMax 开头的聊天模型条目。
 */
function pickQuotaEntry(entries: readonly MinimaxModelRemains[]): MinimaxModelRemains | null {
  const pooled = entries.find((entry) => {
    const name = readString(entry, "model_name", "modelName");
    return name ? name.toLowerCase() === "general" : false;
  });
  if (pooled) return pooled;
  const chat = entries.find((entry) => {
    const name = readString(entry, "model_name", "modelName");
    return name ? name.toLowerCase().startsWith("minimax") : false;
  });
  return chat ?? entries[0] ?? null;
}

export interface MinimaxQuotaSnapshot {
  readonly limits: UsageQuotaLimit[];
  readonly level: string | null;
}

/**
 * 读取一次 MiniMax 套餐额度。
 *
 * 返回 null 表示"拿不到额度"（Key 类型不对、网络失败、响应结构不认识），
 * 调用方据此渲染空态而不是错误态——套餐额度对 API Key 型 provider 是可选数据面。
 */
export async function fetchMinimaxTokenPlanQuota(params: {
  apiClient: ApiClient;
  authorization: string;
  baseUrl: string;
  env?: NodeJS.ProcessEnv;
  requestInit?: ApiRequestInit;
}): Promise<MinimaxQuotaSnapshot | null> {
  const url = new URL(MINIMAX_TOKEN_PLAN_REMAINS_PATH, params.baseUrl).toString();
  let payload: unknown;
  let bodyForLog = "";
  try {
    const response = await params.apiClient.request(url, {
      method: "GET",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${params.authorization}`,
        "Content-Type": "application/json",
      },
      ...params.requestInit,
    });
    if (!response.ok) {
      log.warn(undefined, "MiniMax 套餐额度请求失败", {
        status: response.status,
        url,
      });
      return null;
    }
    // Bug 修复（2026-11-26）：此前把截断后的日志文本直接 JSON.parse，
    // 长响应必然报 "Unterminated string in JSON"。解析必须用原文；
    // 截断副本只进日志。该接口只返回额度计数，不含凭证，可原样记。
    const rawBody = (await response.text()).trim();
    payload = JSON.parse(rawBody) as unknown;
    bodyForLog =
      rawBody.length > MAX_LOGGED_BODY_CHARS
        ? `${rawBody.slice(0, MAX_LOGGED_BODY_CHARS)}…(${rawBody.length} chars)`
        : rawBody;
  } catch (error) {
    log.warn(undefined, "MiniMax 套餐额度请求异常", {
      body: bodyForLog,
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    return null;
  }

  const parsed = minimaxTokenPlanRemainsSchema.safeParse(payload);
  if (!parsed.success) {
    log.warn(undefined, "MiniMax 套餐额度响应结构不符合预期", {
      body: bodyForLog,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`,
      ),
      url,
    });
    return null;
  }

  const parsedBody = parsed.data;
  const baseResp = parsedBody.base_resp ?? parsedBody.baseResp;
  const statusCode = baseResp?.status_code ?? baseResp?.statusCode;
  if (typeof statusCode === "number" && statusCode !== 0) {
    // 上游业务失败（含"用按量 Key 调订阅额度接口"这类鉴权拒绝）如实记日志并返回空态。
    log.warn(undefined, "MiniMax 套餐额度业务失败", {
      body: bodyForLog,
      statusCode,
      statusMsg: baseResp?.status_msg ?? baseResp?.statusMsg ?? null,
      url,
    });
    return null;
  }

  const entries = parsedBody.model_remains ?? parsedBody.modelRemains ?? [];
  const entry = pickQuotaEntry(entries);
  if (!entry) {
    log.warn(undefined, "MiniMax 套餐额度响应缺少 model_remains", { body: bodyForLog, url });
    return null;
  }

  const modelName = readString(entry, "model_name", "modelName") ?? "MiniMax";
  // general 是跨模型共享池，不能在额度卡中作为真实模型明细展示。
  const isSharedPool = modelName.toLowerCase() === "general";
  // 两个窗口各自独立的剩余百分比与重置时间（2026-11-26 实测字段）；
  // usage_percent 仅作旧字段兜底。
  const fiveHourRemainingPercent =
    readNumber(entry, "current_interval_remaining_percent", "currentIntervalRemainingPercent") ??
    readNumber(entry, "usage_percent", "usagePercent");
  const weeklyRemainingPercent = readNumber(
    entry,
    "current_weekly_remaining_percent",
    "currentWeeklyRemainingPercent",
  );
  const fiveHourReset = normalizeTimestampMs(readNumber(entry, "end_time", "endTime"));
  const weeklyReset = normalizeTimestampMs(
    readNumber(entry, "weekly_end_time", "weeklyEndTime"),
  );
  const fiveHourUsed = readNumber(entry, "current_interval_usage_count", "currentIntervalUsageCount");
  const weeklyUsed = readNumber(entry, "current_weekly_usage_count", "currentWeeklyUsageCount");

  const fiveHour = buildWindowLimit({
    total: readNumber(entry, "current_interval_total_count", "currentIntervalTotalCount"),
    ...(fiveHourUsed === undefined ? {} : { used: fiveHourUsed }),
    ...(fiveHourRemainingPercent === undefined ? {} : { remainingPercent: fiveHourRemainingPercent }),
    unit: FIVE_HOUR_LIMIT_UNIT,
    number: FIVE_HOUR_LIMIT_NUMBER,
    ...(fiveHourReset === undefined ? {} : { nextResetTime: fiveHourReset }),
    usageDetails: isSharedPool
      ? []
      : [{ modelCode: modelName, displayName: modelName, usage: fiveHourUsed ?? 0 }],
  });
  const weekly = buildWindowLimit({
    total: readNumber(entry, "current_weekly_total_count", "currentWeeklyTotalCount"),
    ...(weeklyUsed === undefined ? {} : { used: weeklyUsed }),
    ...(weeklyRemainingPercent === undefined ? {} : { remainingPercent: weeklyRemainingPercent }),
    unit: WEEKLY_LIMIT_UNIT,
    ...(weeklyReset === undefined ? {} : { nextResetTime: weeklyReset }),
    usageDetails: isSharedPool
      ? []
      : [{ modelCode: modelName, displayName: modelName, usage: weeklyUsed ?? 0 }],
  });

  const limits = [fiveHour, weekly].filter((limit): limit is UsageQuotaLimit => limit !== null);
  if (limits.length === 0) {
    log.warn(undefined, "MiniMax 套餐额度缺少可展示的窗口数据", {
      body: bodyForLog,
      modelName,
      url,
    });
    return null;
  }

  // 成功也记一条摘要（只有额度计数，不含凭证）：额度卡数字对不上控制台时，
  // 没有这条就无法核对是映射问题还是上游数据问题。
  log.info(undefined, "MiniMax 套餐额度已更新", {
    entryCount: entries.length,
    fiveHourRemainingPercent: fiveHourRemainingPercent ?? null,
    weeklyRemainingPercent: weeklyRemainingPercent ?? null,
    fiveHourReset: fiveHourReset ?? null,
    weeklyReset: weeklyReset ?? null,
    modelName,
    url,
  });

  return { limits, level: null };
}

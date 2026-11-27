/* DeepSeek 账户余额读取（`GET /user/balance`）。
 *
 * 与 MiniMax 的 `token_plan/remains` 同属「供应商自带数据直查」：余额只由 DeepSeek
 * 自己掌握，走官方接口读取，不经过 ZCode 服务端，因此不需要账号型 provider、不需要 OAuth。
 *
 * 与 MiniMax 配额的两处关键差异：
 * 1. **认证**：用普通 API Key 即可（DeepSeek 的余额接口与模型调用共用同一把 Key，
 *    没有 MiniMax 那种「订阅 Key / 按量 Key」之分）。
 * 2. **语义**：返回的是**货币金额**而非配额窗口。余额没有配额上限、没有已用量、
 *    没有百分比分母，因此映射到独立的 `UsageProviderBalance` 契约，
 *    不复用 `UsageQuotaLimit`（其 percentage 是已用占比，填余额会编造口径）。
 *
 * 官方响应（https://api-docs.deepseek.com/zh-cn/api/get-user-balance/）：
 * ```json
 * {
 *   "is_available": true,
 *   "balance_infos": [
 *     {
 *       "currency": "CNY",
 *       "total_balance": "110.00",
 *       "granted_balance": "10.00",
 *       "topped_up_balance": "100.00"
 *     }
 *   ]
 * }
 * ```
 * 金额是字符串，需转 number；`balance_infos` 是数组，多币种时逐项返回、不合并。
 */
import { z } from "zod";
import type { ApiClient, ApiRequestInit, UsageProviderBalance } from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";

const DEEPSEEK_BALANCE_PATH = "/user/balance";
const REQUEST_TIMEOUT_MS = 15_000;
/** 响应体截断长度。余额响应很小（每个币种 4 个字段），1KB 足够看到全量字段。 */
const MAX_LOGGED_BODY_CHARS = 1024;
const log = createServiceLogger("usage-stats");

/**
 * 判定 baseUrl 是否指向 DeepSeek 官方余额接口。
 *
 * 按 host 判定而不是按 templateId：个人实例可以基于任意模板创建，也可能改过端点，
 * host 才是余额接口实际会去的那台机器。判定沿用 `isMinimaxQuotaBaseUrl` 的同款口径。
 */
export function isDeepseekBalanceBaseUrl(baseUrl: string | null | undefined): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return false;
  let hostname: string;
  try {
    hostname = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === "api.deepseek.com" || hostname.endsWith(".api.deepseek.com");
}

/** 单个币种的余额条目。金额字段在官方响应里是字符串，这里接受字符串与数字两种形态。 */
const deepseekBalanceInfoSchema = z
  .object({
    currency: z.string().optional(),
    total_balance: z.union([z.string(), z.number()]).optional(),
    granted_balance: z.union([z.string(), z.number()]).optional(),
    topped_up_balance: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const deepseekBalanceSchema = z
  .object({
    is_available: z.boolean().optional(),
    balance_infos: z.array(deepseekBalanceInfoSchema).optional(),
  })
  .passthrough();

type DeepseekBalanceInfo = z.infer<typeof deepseekBalanceInfoSchema>;

/**
 * 解析金额字段。
 *
 * 官方返回字符串（如 "110.00"），不同版本与第三方实现也可能返回数字，两种都接受。
 * 空串、null、NaN 一律视为缺失：余额展示不能拿 0 顶替「接口没给这个值」。
 */
function readAmount(
  entry: DeepseekBalanceInfo,
  ...keys: readonly (keyof DeepseekBalanceInfo)[]
): number | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readCurrency(entry: DeepseekBalanceInfo): string | undefined {
  const currency = entry.currency?.trim();
  return currency ? currency.toUpperCase() : undefined;
}

export interface DeepseekBalanceSnapshot {
  readonly available: boolean;
  readonly balances: UsageProviderBalance[];
}

/**
 * 读取一次 DeepSeek 账户余额。
 *
 * 返回 null 表示「拿不到余额」（网络失败、鉴权拒绝、响应结构不认识），
 * 调用方据此展示不可用态而不是错误态——余额对 API Key 型 provider 是可选数据面。
 */
export async function fetchDeepseekBalance(params: {
  apiClient: ApiClient;
  authorization: string;
  baseUrl: string;
  env?: NodeJS.ProcessEnv;
  requestInit?: ApiRequestInit;
}): Promise<DeepseekBalanceSnapshot | null> {
  const url = new URL(DEEPSEEK_BALANCE_PATH, params.baseUrl).toString();
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
      log.warn(undefined, "DeepSeek 账户余额请求失败", {
        status: response.status,
        url,
      });
      return null;
    }
    // 解析必须用原文；截断副本只进日志（截断后的文本直接 JSON.parse 会报
    // "Unterminated string in JSON"）。该接口只返回余额金额，不含凭证，可原样记。
    const rawBody = (await response.text()).trim();
    payload = JSON.parse(rawBody) as unknown;
    bodyForLog =
      rawBody.length > MAX_LOGGED_BODY_CHARS
        ? `${rawBody.slice(0, MAX_LOGGED_BODY_CHARS)}…(${rawBody.length} chars)`
        : rawBody;
  } catch (error) {
    log.warn(undefined, "DeepSeek 账户余额请求异常", {
      body: bodyForLog,
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    return null;
  }

  const parsed = deepseekBalanceSchema.safeParse(payload);
  if (!parsed.success) {
    log.warn(undefined, "DeepSeek 账户余额响应结构不符合预期", {
      body: bodyForLog,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`,
      ),
      url,
    });
    return null;
  }

  const available = parsed.data.is_available !== false;
  const entries = parsed.data.balance_infos ?? [];
  const balances: UsageProviderBalance[] = [];
  for (const entry of entries) {
    const currency = readCurrency(entry);
    const totalBalance = readAmount(entry, "total_balance");
    if (!currency || totalBalance === undefined) {
      // 缺币种或缺总额时无法展示一条余额明细；跳过而不是补 0。
      log.warn(undefined, "DeepSeek 账户余额条目缺少币种或总额", { body: bodyForLog, url });
      continue;
    }
    balances.push({
      currency,
      totalBalance,
      grantedBalance: readAmount(entry, "granted_balance") ?? 0,
      toppedUpBalance: readAmount(entry, "topped_up_balance") ?? 0,
    });
  }

  if (balances.length === 0) {
    log.warn(undefined, "DeepSeek 账户余额响应缺少 balance_infos", { body: bodyForLog, url });
    return null;
  }

  // 成功也记一条摘要（只有余额金额，不含凭证）：余额对不上控制台时，
  // 没有这条就无法核对是映射问题还是上游数据问题。
  log.info(undefined, "DeepSeek 账户余额已更新", {
    available,
    balances: balances.map((balance) => ({
      currency: balance.currency,
      totalBalance: balance.totalBalance,
    })),
    url,
  });

  return { available, balances };
}

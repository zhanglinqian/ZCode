import type {
  ApiClient,
  AppUsageRequest,
  AppUsageSnapshot,
  CodingPlanUsageRequest,
  CodingPlanUsageSnapshot,
  CodingPlanRegularTpsRequest,
  CodingPlanResetOpportunityRequest,
  CodingPlanResetOpportunityResult,
  CodingPlanResetScopeRequest,
  CodingPlanResetStatusSnapshot,
  CodingPlanResetUseRequest,
  CodingPlanResetUseResult,
  UsageEntitlementRequest,
  UsageEntitlementSnapshot,
  UsageStatsRequest,
  UsageStatsSnapshot,
} from "@zcode/shared";
import { isCodingPlanModelProviderId } from "@zcode/shared";
import type { OAuthAccountMaterial } from "#src/oauth/repo/oauthCredentialRepo.js";
import type { IAccountRequestAuthService } from "../model-provider/accountRequestAuthService.js";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";
import {
  BigModelUsageQuotaProvider,
  type UsageApiAuthorizationRequest,
  type UsageApiAuthorization,
} from "./providers/bigmodelUsageQuotaProvider.js";
import type { OfficialMcpCredentialSource } from "./providers/zcodeMcpQuotaProvider.js";
import {
  fetchMinimaxTokenPlanQuota,
  isMinimaxQuotaBaseUrl,
} from "./providers/minimaxQuotaProvider.js";
import { fetchDeepseekBalance, isDeepseekBalanceBaseUrl } from "./providers/deepseekBalanceProvider.js";

/**
 * 供应商自带额度查询的 provider 事实。
 *
 * 与 GLM 的账号型额度不同：MiniMax 的额度只由 MiniMax 自己掌握，走官方
 * `token_plan/remains` 接口直连读取，不经过 ZCode 服务端。因此这里只需要
 * 该 provider 已配置的 API Key 与端点，不需要账号材料。
 */
export interface ProviderSelfQuotaFacts {
  /** provider 配置里的 API Key（订阅 Key）。 */
  readonly apiKey: string;
  /** provider 配置里的 baseUrl，用于判定是否 MiniMax 官方端点。 */
  readonly baseUrl: string;
  /** 展示用供应商标识。 */
  readonly providerName: string;
}

interface UsageStatsServiceDependencies {
  apiClient: ApiClient;
  loadOAuthAccountMaterial(family: "zai" | "bigmodel"): Promise<OAuthAccountMaterial | null>;
  accountRequestAuthService: Pick<
    IAccountRequestAuthService,
    "resolveAccessCurrent" | "resolveCurrent"
  >;
  resolveApiAuthorization?: (
    request: UsageApiAuthorizationRequest,
  ) => Promise<UsageApiAuthorization | null>;
  /**
   * 读取指定 provider 的配置事实（API Key 与端点），供供应商自带额度查询使用。
   * 缺省时不提供供应商自带额度，entitlement 只走账号型链路。
   */
  resolveProviderSelfQuotaFacts?: (
    providerId: string,
  ) => Promise<ProviderSelfQuotaFacts | null>;
  env?: NodeJS.ProcessEnv;
  /** App Usage 经 ZCode Protocol 读取 agent 数据库真实统计。 */
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats">;
  /**
   * 官方 Server MCP 额度的凭证来源（与 server MCP 调用同一套 5 个身份头）。
   * 缺省时 entitlement 快照不含 MCP 额度。
   */
  officialMcpCredentialSource?: OfficialMcpCredentialSource;
}

const CODING_PLAN_REGULAR_TPS_CACHE_MS = 5 * 60_000;

function isCodingPlanProviderId(providerId: string | undefined): boolean {
  return Boolean(providerId && isCodingPlanModelProviderId(providerId));
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  const quotaProvider = new BigModelUsageQuotaProvider({
    apiClient: dependencies.apiClient,
    loadOAuthAccountMaterial: dependencies.loadOAuthAccountMaterial,
    accountRequestAuthService: dependencies.accountRequestAuthService,
    resolveApiAuthorization: dependencies.resolveApiAuthorization,
    env: dependencies.env,
    ...(dependencies.officialMcpCredentialSource
      ? { officialMcpCredentialSource: dependencies.officialMcpCredentialSource }
      : {}),
  });
  const regularTpsCache = new Map<string, { expiresAt: number; value: number | undefined }>();
  const regularTpsInFlight = new Map<string, Promise<number | undefined>>();

  /**
   * 供应商自带额度（MiniMax 配额 / DeepSeek 余额）的 entitlement 快照。
   *
   * 与账号型额度是两条互斥的数据来源：GLM 的额度由 ZCode 服务端下发，
   * MiniMax 的额度由 MiniMax 自己的 `token_plan/remains` 返回，DeepSeek 的余额由
   * DeepSeek 自己的 `user/balance` 返回。命中供应商自带数据源时直接返回该快照，
   * 不再落回账号型链路，避免把供应商的 Key 当成账号材料去查服务端。
   *
   * 只认 `preferredProviderId`：不按"当前选中的 provider"猜，避免误把别的供应商的额度
   * 挂到当前面板。
   */
  async function getProviderSelfQuotaSnapshot(
    request: UsageEntitlementRequest,
  ): Promise<UsageEntitlementSnapshot | null> {
    const providerId = request.preferredProviderId?.trim() ?? "";
    if (!providerId || !dependencies.resolveProviderSelfQuotaFacts) {
      return null;
    }
    let facts: ProviderSelfQuotaFacts | null;
    try {
      facts = await dependencies.resolveProviderSelfQuotaFacts(providerId);
    } catch {
      return null;
    }
    if (!facts) {
      return null;
    }
    const apiKey = facts.apiKey.trim();
    if (!apiKey) {
      return null;
    }
    // 命中供应商自带端点后绝不回落 GLM 账号型链路：失败也要返回明确的 unavailable
    // 快照，否则会把 GLM 套餐数据当成该供应商的额度展示（2026-11-26 修复过的同类 bug）。
    const providerInfo = { id: providerId, name: facts.providerName };

    if (isMinimaxQuotaBaseUrl(facts.baseUrl)) {
      const snapshot = await fetchMinimaxTokenPlanQuota({
        apiClient: dependencies.apiClient,
        authorization: apiKey,
        baseUrl: facts.baseUrl,
        ...(dependencies.env ? { env: dependencies.env } : {}),
      });
      if (!snapshot) {
        return {
          generatedAt: Date.now(),
          authenticated: false,
          unavailableReason: "unavailable",
          provider: providerInfo,
          remaining: null,
          subscription: null,
          quota: null,
        };
      }
      return {
        generatedAt: Date.now(),
        authenticated: true,
        provider: providerInfo,
        remaining: null,
        subscription: null,
        quota: { level: snapshot.level, limits: snapshot.limits },
      };
    }

    if (isDeepseekBalanceBaseUrl(facts.baseUrl)) {
      const snapshot = await fetchDeepseekBalance({
        apiClient: dependencies.apiClient,
        authorization: apiKey,
        baseUrl: facts.baseUrl,
        ...(dependencies.env ? { env: dependencies.env } : {}),
      });
      if (!snapshot) {
        return {
          generatedAt: Date.now(),
          authenticated: false,
          unavailableReason: "unavailable",
          provider: providerInfo,
          remaining: null,
          subscription: null,
          quota: null,
          providerBalance: null,
        };
      }
      return {
        generatedAt: Date.now(),
        authenticated: true,
        provider: providerInfo,
        remaining: null,
        subscription: null,
        quota: null,
        providerBalance: snapshot,
      };
    }

    return null;
  }

  function regularTpsCacheKey(request: CodingPlanRegularTpsRequest): string {
    return JSON.stringify([
      request.preferredProviderId,
      // Team scope（organizationId/projectId）已内含在 accountAccess 里，整体入 key，
      // 避免同一 provider 下不同账号或不同团队项目共用同一条 TPS 缓存。
      request.accountAccess,
      request.timeZone ?? null,
    ]);
  }

  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 现读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 ZCode Protocol usage/stats 取回。不再读本地 session JSON 估算。
      return dependencies.zcodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
    async getCodingPlanUsageSnapshot(
      request: CodingPlanUsageRequest,
    ): Promise<CodingPlanUsageSnapshot> {
      if (!isCodingPlanProviderId(request.preferredProviderId)) {
        // Coding Plan 页面只允许预置的 Z.AI/BigModel Coding Plan 账号。
        // 普通 provider id 不能进入 monitor 链路，避免误读 API Key 或环境变量。
        throw new Error("no_bigmodel_api_key");
      }
      return quotaProvider.getCodingPlanUsageSnapshot(request);
    },
    async getCodingPlanRegularTps(
      request: CodingPlanRegularTpsRequest,
    ): Promise<number | undefined> {
      if (!isCodingPlanProviderId(request.preferredProviderId)) {
        throw new Error("no_bigmodel_api_key");
      }
      const key = regularTpsCacheKey(request);
      const cached = regularTpsCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const existing = regularTpsInFlight.get(key);
      if (existing) return existing;

      const requestPromise = quotaProvider
        .getCodingPlanRegularTps(request)
        .then((value) => {
          regularTpsCache.set(key, {
            expiresAt: Date.now() + CODING_PLAN_REGULAR_TPS_CACHE_MS,
            value,
          });
          return value;
        })
        .finally(() => {
          regularTpsInFlight.delete(key);
        });
      regularTpsInFlight.set(key, requestPromise);
      return requestPromise;
    },
    async getCodingPlanResetStatus(
      request: CodingPlanResetScopeRequest,
    ): Promise<CodingPlanResetStatusSnapshot> {
      if (!isCodingPlanProviderId(request.preferredProviderId)) {
        throw new Error("no_bigmodel_api_key");
      }
      return quotaProvider.getCodingPlanResetStatus(request);
    },
    async requestCodingPlanResetOpportunity(
      request: CodingPlanResetOpportunityRequest,
    ): Promise<CodingPlanResetOpportunityResult> {
      if (!isCodingPlanProviderId(request.preferredProviderId)) {
        throw new Error("no_bigmodel_api_key");
      }
      return quotaProvider.requestCodingPlanResetOpportunity(request);
    },
    async useCodingPlanReset(
      request: CodingPlanResetUseRequest,
    ): Promise<CodingPlanResetUseResult> {
      if (!isCodingPlanProviderId(request.preferredProviderId)) {
        throw new Error("no_bigmodel_api_key");
      }
      return quotaProvider.useCodingPlanReset(request);
    },
    async markCodingPlanResetHistoryRead(request: CodingPlanResetScopeRequest): Promise<void> {
      if (!isCodingPlanProviderId(request.preferredProviderId)) {
        throw new Error("no_bigmodel_api_key");
      }
      await quotaProvider.markCodingPlanResetHistoryRead(request);
    },
    async getSnapshot(request: UsageStatsRequest): Promise<UsageStatsSnapshot> {
      // App Usage 已迁移到 getAppUsageSnapshot（agent 数据库）。getSnapshot 仅服务 Coding Plan monitor 链路。
      // 任何 monitor 失败都不能回退本地数据，保持数据源隔离。
      return quotaProvider.getUsageStatsSnapshot(request);
    },
    async getEntitlementSnapshot(
      request: UsageEntitlementRequest = {},
    ): Promise<UsageEntitlementSnapshot> {
      const selfQuotaSnapshot = await getProviderSelfQuotaSnapshot(request);
      if (selfQuotaSnapshot) {
        return selfQuotaSnapshot;
      }
      return quotaProvider.getSnapshotForRequest(request);
    },
  };
}

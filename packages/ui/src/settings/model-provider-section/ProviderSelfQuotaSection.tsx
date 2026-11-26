/* 供应商自带额度的「套餐额度」区块（当前用于 MiniMax）。
 *
 * 与 GLM 的 Coding Plan 额度卡不同：GLM 的额度由 ZCode 服务端下发（依赖平台登录的
 * JWT），而 MiniMax 的额度只凭 provider 配置里的订阅 Key 直连 MiniMax 官方
 * `token_plan/remains` 接口，与 ZCode 账号态完全无关。因此这里**刻意不走**
 * `useUsageEntitlement`——那个 hook 带 `signed-out` 禁用门槛，会让未登录 ZCode 的
 * 用户连 MiniMax 额度也查不了（2026-11-26 实测踩坑）。改为组件内直接调
 * `usageStatsService.getEntitlementSnapshot`，单组件使用，无需共享缓存与 in-flight 合并。
 *
 * 只有「5 小时窗口 + 周窗口」两个额度桶，复用同一套卡片视觉单元，
 * 不引入 Coding Plan 的重置机会、订阅摘要等 ZCode 服务端专属交互。
 */
import { useEffect, useMemo, useState } from "react";
import type { UsageEntitlementSnapshot, UsageQuotaLimit } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { PlanUsageMetricCard } from "./StatusCards.js";

/** 窗口额度桶的匹配口径，与 services 层 minimaxQuotaProvider 的映射保持一致。 */
const FIVE_HOUR_LIMIT_UNIT = 3;
const WEEKLY_LIMIT_UNIT = 6;

const QUOTA_CARD_COLORS = ["var(--color-usage-chart-1)", "var(--color-usage-chart-2)"] as const;

/**
 * 判定 provider 是否具备供应商自带额度查询能力。
 *
 * 与 services 层同口径按 host 判定：个人实例可基于任意模板创建，也可能改过端点，
 * host 才是额度接口实际会去的那台机器。
 */
export function isProviderSelfQuotaBaseUrl(baseUrl: string | null | undefined): boolean {
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

function findWindowLimit(limits: readonly UsageQuotaLimit[], unit: number) {
  return limits.find((limit) => limit.unit === unit);
}

/**
 * 供应商自带额度的轻量查询：直接打 usage-stats RPC，不经过共享 entitlement 缓存，
 * 也不受登录态约束。providerId 或服务实例变化时重查；disabled 时清空。
 *
 * 带模块级 in-flight 去重与 30s TTL：设置页的 store 更新会让本组件频繁重渲染，
 * effect 依赖里的服务实例随之变化，无去重时会对 MiniMax 上游每秒发起多次请求
 * （2026-11-26 实测日志）。同一 provider 的并发请求共享同一个 Promise；
 * 30 秒内的重复挂载直接复用上次结果。
 */
const SELF_QUOTA_TTL_MS = 30_000;
const selfQuotaCache = new Map<
  string,
  { expiresAt: number; snapshot: UsageEntitlementSnapshot | null; error: string | null }
>();

function useProviderSelfQuotaSnapshot(providerId: string, enabled: boolean) {
  const services = useOptionalBaseWorkspaceServices();
  const usageStatsService = services?.usageStatsService;
  const [state, setState] = useState<{
    snapshot: UsageEntitlementSnapshot | null;
    error: string | null;
  }>(() => {
    const cached = selfQuotaCache.get(providerId);
    return cached && cached.expiresAt > Date.now()
      ? { snapshot: cached.snapshot, error: cached.error }
      : { snapshot: null, error: null };
  });

  useEffect(() => {
    if (!enabled || !usageStatsService) {
      return;
    }
    let cancelled = false;
    const cached = selfQuotaCache.get(providerId);
    if (cached && cached.expiresAt > Date.now()) {
      setState({ snapshot: cached.snapshot, error: cached.error });
      return;
    }
    setState({ snapshot: null, error: null });
    usageStatsService
      .getEntitlementSnapshot({
        preferredProviderId: providerId,
        // 额度属于当前 provider 自己，必须命中它，不能回退到别的供应商。
        requirePreferredProvider: true,
      })
      .then((snapshot) => {
        selfQuotaCache.set(providerId, {
          expiresAt: Date.now() + SELF_QUOTA_TTL_MS,
          snapshot,
          error: null,
        });
        if (!cancelled) setState({ snapshot, error: null });
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        selfQuotaCache.set(providerId, {
          expiresAt: Date.now() + SELF_QUOTA_TTL_MS,
          snapshot: null,
          error: message,
        });
        if (!cancelled) setState({ snapshot: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, providerId, usageStatsService]);

  return state;
}

export function ProviderSelfQuotaSection({
  providerId,
  baseUrl,
}: {
  providerId: string;
  baseUrl: string | null | undefined;
}) {
  const { intl } = useZCodeIntl();
  const supported = isProviderSelfQuotaBaseUrl(baseUrl);
  // 端点不支持时不发请求：否则每次打开任意 API Key provider 都会多一次无意义的
  // entitlement 查询。
  const { snapshot, error } = useProviderSelfQuotaSnapshot(providerId, supported);

  const limits = useMemo(() => snapshot?.quota?.limits ?? [], [snapshot]);
  if (!supported) {
    return null;
  }

  const fiveHour = findWindowLimit(limits, FIVE_HOUR_LIMIT_UNIT);
  const weekly = findWindowLimit(limits, WEEKLY_LIMIT_UNIT);
  const cards = [
    fiveHour
      ? {
          key: "fiveHour",
          label: intl.formatMessage({ id: "settings.usage.entitlementFiveHourUsage" }),
          limit: fiveHour,
          progressColor: QUOTA_CARD_COLORS[0],
          resetTimeFormat: "dateTime" as const,
        }
      : null,
    weekly
      ? {
          key: "weekly",
          label: intl.formatMessage({ id: "settings.usage.entitlementWeeklyUsage" }),
          limit: weekly,
          progressColor: QUOTA_CARD_COLORS[1],
          resetTimeFormat: "date" as const,
        }
      : null,
  ].filter((card): card is NonNullable<typeof card> => card !== null);

  // 查询明确失败（RPC 报错，或服务层返回 quota 为空的 unavailable 快照）时展示失败提示。
  // 失败态必须如实展示：多半是填了按量 Key 而不是订阅 Key，或接口字段变化，
  // 静默隐藏会让用户以为卡片功能不存在，更不能拿别的供应商的额度顶上。
  // 加载中（snapshot 为 null 且无错误）保持空白，避免闪一个空标题。
  const unavailable = !error && snapshot !== null && limits.length === 0;
  if (cards.length === 0 && !error && !unavailable) {
    return null;
  }

  const showFailureHint = Boolean(error) || unavailable;

  return (
    <div className="space-y-2">
      <h4 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.usage.quotaTitle" })}
      </h4>
      {showFailureHint ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.selfQuota.unavailable" })}
        </p>
      ) : null}
      <div className="flex w-full gap-2 max-sm:flex-col">
        {cards.map((card) => (
          <PlanUsageMetricCard
            key={card.key}
            label={card.label}
            limit={card.limit}
            progressColor={card.progressColor}
            resetTimeFormat={card.resetTimeFormat}
          />
        ))}
      </div>
    </div>
  );
}

/* 聊天输入框 context 面板的「供应商自带额度/余额」段（MiniMax 用量 / DeepSeek 余额）。
 *
 * 与 Coding Plan / Start Plan 面板互斥：当前选中模型命中供应商自带端点
 * （MiniMax host → 配额窗口，DeepSeek host → 账户余额）且已填 Key 时，
 * 由 V4ComposerToolbar 构造 config 挂载本段。
 *
 * 数据不在 composer 挂载时请求：面板打开（hover/click）时才经
 * `useProviderSelfUsageSnapshot` 拉取，与设置页共享同一份模块级 30s TTL 缓存，
 * 遵守 usage-remaining-refresh-policy 的「缓存优先 + 用户访问时校正」。
 *
 * 两种 kind 的视觉语义不同：
 * - quota（MiniMax）：复用 Coding Plan 的 compact meter（剩余百分比 + 重置时间 + 进度条）；
 * - balance（DeepSeek）：金额行，无进度条——余额没有配额上限，画百分比是编造口径。
 */
import { LoaderCircle } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { UsageProviderBalance, UsageQuotaLimit } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import type { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  formatQuotaRemainingPercentage,
  formatQuotaResetTime,
  getQuotaRemainingPercentage,
} from "@/lib/codingPlanQuotaPresentation.js";
import { formatBalanceAmount } from "@/settings/model-provider-section/selfBalanceFormat.js";
import { useProviderSelfUsageSnapshot } from "@/settings/model-provider-section/providerSelfUsageSnapshot.js";
import { getContextQuotaMeterGridClass } from "@/chat-input-toolbar/contextQuotaMeterGrid.js";
import { ChatCodingPlanUsageMeter } from "@/chat-input-toolbar/CodingPlanContextUsage.js";

export type ChatProviderSelfUsageKind = "quota" | "balance";

export interface ChatProviderSelfUsageConfig {
  providerId: string;
  providerName: string;
  kind: ChatProviderSelfUsageKind;
  /** 「更多」入口：打开使用统计页对应的供应商自带数据 tab。 */
  onUsageClick?: () => void;
}

/** config 存在即视为可展示：端点与 Key 已由 toolbar 校验；首次数据靠 hover 打开面板拉取。 */
export function hasChatProviderSelfUsage(
  config: ChatProviderSelfUsageConfig | undefined,
): boolean {
  return Boolean(config);
}

const SELF_QUOTA_METER_COLORS = [
  "var(--color-usage-chart-1)",
  "var(--color-usage-chart-2)",
] as const;

/** 窗口额度桶的匹配口径，与 services 层 minimaxQuotaProvider / 设置页 ProviderSelfQuotaSection 一致。 */
const FIVE_HOUR_LIMIT_UNIT = 3;
const WEEKLY_LIMIT_UNIT = 6;

function findWindowLimit(limits: readonly UsageQuotaLimit[], unit: number) {
  return limits.find((limit) => limit.unit === unit);
}

function ProviderSelfQuotaMeters({
  limits,
  intl,
  locale,
}: {
  limits: readonly UsageQuotaLimit[];
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  locale: string;
}) {
  const fiveHour = findWindowLimit(limits, FIVE_HOUR_LIMIT_UNIT);
  const weekly = findWindowLimit(limits, WEEKLY_LIMIT_UNIT);
  const meters = [
    fiveHour
      ? {
          key: "fiveHour",
          label: intl.formatMessage({ id: "settings.usage.entitlementFiveHourUsage" }),
          limit: fiveHour,
          // 5 小时窗口临近当天切换，展示时分才有信息量；对齐 Coding Plan 五小时口径。
          resetTime: formatQuotaResetTime({
            locale,
            value: fiveHour.nextResetTime,
            format: "dateTime",
            compactToday: true,
          }),
        }
      : null,
    weekly
      ? {
          key: "weekly",
          label: intl.formatMessage({ id: "settings.usage.entitlementWeeklyUsage" }),
          limit: weekly,
          resetTime: formatQuotaResetTime({
            locale,
            value: weekly.nextResetTime,
            format: "date",
          }),
        }
      : null,
  ].filter((meter): meter is NonNullable<typeof meter> => meter !== null);

  return (
    <div className={cn("grid gap-2", getContextQuotaMeterGridClass(meters.length))}>
      {meters.map((meter, index) => (
        <ChatCodingPlanUsageMeter
          key={meter.key}
          color={
            SELF_QUOTA_METER_COLORS[index % SELF_QUOTA_METER_COLORS.length] ??
            SELF_QUOTA_METER_COLORS[0]
          }
          label={meter.label}
          percentage={getQuotaRemainingPercentage(meter.limit)}
          resetTime={meter.resetTime}
          value={formatQuotaRemainingPercentage(locale, meter.limit)}
        />
      ))}
    </div>
  );
}

function ProviderSelfBalanceRows({
  balances,
  locale,
}: {
  balances: readonly UsageProviderBalance[];
  locale: string;
}) {
  return (
    <div className="space-y-1.5">
      {balances.map((balance) => (
        <div key={balance.currency} className="min-w-0 space-y-0.5 text-ui-sm">
          {/* 总额不带「总余额」字幕：与标题「账户余额」连读已表达总额语义，
              多币种时由币种符号/代码本身区分，避免每行重复同一标签。 */}
          <div className="min-w-0 text-ui-sm tabular-nums">
            <span className="font-mono text-foreground">
              {formatBalanceAmount(locale, balance.totalBalance, balance.currency)}
            </span>
          </div>
          <div className="min-w-0 text-ui-xs tabular-nums text-foreground-subtle">
            {formatBalanceAmount(locale, balance.grantedBalance, balance.currency)} ·{" "}
            {formatBalanceAmount(locale, balance.toppedUpBalance, balance.currency)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatProviderSelfUsagePanel({
  config,
  open,
  intl,
  locale,
  separated = false,
}: {
  config: ChatProviderSelfUsageConfig;
  /** 面板是否展开（hover/click）；展开时才发起/校正数据请求。 */
  open: boolean;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  locale: string;
  separated?: boolean;
}) {
  const { snapshot, error } = useProviderSelfUsageSnapshot(config.providerId, open);

  const isBalance = config.kind === "balance";
  const limits = isBalance ? [] : (snapshot?.quota?.limits ?? []);
  const balances = isBalance ? (snapshot?.providerBalance?.balances ?? []) : [];
  const hasData = isBalance ? balances.length > 0 : limits.length > 0;
  // 服务层命中供应商端点后失败一律返回 unavailable 快照（不回落 GLM），
  // 这里与 RPC 报错同路展示失败文案。
  const unavailable = !error && snapshot !== null && !hasData;
  const loading = open && snapshot === null && !error;
  const balanceAvailable = snapshot?.providerBalance?.available !== false;

  return (
    <div className={separated ? "border-t border-border pt-2" : undefined}>
      <div className="mb-2 flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui-base font-medium text-foreground">
            {intl.formatMessage({
              id: isBalance
                ? "settings.modelProvider.selfBalance.title"
                : "sidebar.usage.plan.title",
            })}
          </span>
          {loading ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-foreground-subtle" />
          ) : null}
        </div>
        {config.onUsageClick ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-ui-sm text-foreground-subtle transition-colors hover:text-foreground"
            onClick={config.onUsageClick}
          >
            {intl.formatMessage({ id: "sidebar.usage.plan.open" })}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {loading ? null : error || unavailable ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({
            id: isBalance
              ? "settings.modelProvider.selfBalance.unavailable"
              : "settings.modelProvider.selfQuota.unavailable",
          })}
        </p>
      ) : isBalance ? (
        <>
          {!balanceAvailable && balances.length > 0 ? (
            <p className="mb-1.5 text-ui-xs text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.selfBalance.unavailable" })}
            </p>
          ) : null}
          <ProviderSelfBalanceRows balances={balances} locale={locale} />
        </>
      ) : (
        <ProviderSelfQuotaMeters limits={limits} intl={intl} locale={locale} />
      )}
    </div>
  );
}

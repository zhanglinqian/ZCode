/* 供应商自带账户余额区块（当前用于 DeepSeek 的 `GET /user/balance`）。
 *
 * 与 MiniMax 的套餐额度区块分开：两者数据语义不同——
 * MiniMax 是配额窗口（5 小时 / 周），能换算成剩余百分比，用 `PlanUsageMetricCard` 的
 * 进度条展示；DeepSeek 是**货币余额**，没有配额上限、没有已用量、没有百分比分母，
 * 画进度条只能是编造口径，因此这里用金额卡片展示，且不复用配额卡组件。
 *
 * 认证用 provider 已配置的普通 API Key（余额接口与模型调用共用同一把 Key）。
 * 查询与 TTL 缓存复用 `useProviderSelfUsageSnapshot`，与额度区块共用一份缓存。
 */
import { useMemo } from "react";
import type { UsageProviderBalance } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderSelfUsageSnapshot } from "./providerSelfUsageSnapshot.js";
import { formatBalanceAmount } from "./selfBalanceFormat.js";

/**
 * 判定 baseUrl 是否为支持余额查询的供应商端点。
 *
 * 与服务层 `isDeepseekBalanceBaseUrl` 保持同款 host 口径：host 才是余额接口实际会去的
 * 那台机器（个人实例可基于任意模板创建，也可能改过端点）。
 */
export function isProviderSelfBalanceBaseUrl(baseUrl: string | null | undefined): boolean {
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

export function ProviderSelfBalanceSection({
  providerId,
  baseUrl,
}: {
  providerId: string;
  baseUrl: string | null | undefined;
}) {
  const { intl, locale } = useZCodeIntl();
  const supported = isProviderSelfBalanceBaseUrl(baseUrl);
  // 端点不支持时不发请求：否则每次打开任意 API Key provider 都会多一次无意义的查询。
  const { snapshot, error } = useProviderSelfUsageSnapshot(providerId, supported);

  const balances = useMemo(() => snapshot?.providerBalance?.balances ?? [], [snapshot]);
  const available = snapshot?.providerBalance?.available ?? false;
  if (!supported) {
    return null;
  }

  // 查询明确失败（RPC 报错，或服务层返回余额为空的 unavailable 快照）时展示失败提示。
  // 失败态必须如实展示：静默隐藏会让用户以为卡片功能不存在，
  // 更不能拿别的供应商的额度顶上。
  // 加载中（snapshot 为 null 且无错误）保持空白，避免闪一个空标题。
  const unavailable = !error && snapshot !== null && balances.length === 0;
  if (balances.length === 0 && !error && !unavailable) {
    return null;
  }

  const showFailureHint = Boolean(error) || unavailable;

  return (
    <div className="space-y-2">
      <h4 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.modelProvider.selfBalance.title" })}
      </h4>
      {showFailureHint ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.selfBalance.unavailable" })}
        </p>
      ) : null}
      {!available && !showFailureHint ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.selfBalance.unavailable" })}
        </p>
      ) : null}
      {balances.length > 0 ? (
        <div className="flex w-full gap-2 max-sm:flex-col">
          {balances.map((balance) => (
            <ProviderBalanceCard key={balance.currency} balance={balance} locale={locale} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProviderBalanceCard({
  balance,
  locale,
}: {
  balance: UsageProviderBalance;
  locale: string;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-surface p-3">
      <div className="truncate text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.modelProvider.selfBalance.total" })}
      </div>
      <div className="mt-2 flex min-w-0 items-baseline gap-1.5">
        <span className="text-ui-lg font-semibold leading-none text-foreground">
          {formatBalanceAmount(locale, balance.totalBalance, balance.currency)}
        </span>
      </div>
      <div className="mt-2 space-y-0.5">
        <BalanceDetailRow
          label={intl.formatMessage({ id: "settings.modelProvider.selfBalance.granted" })}
          amount={balance.grantedBalance}
          currency={balance.currency}
          locale={locale}
        />
        <BalanceDetailRow
          label={intl.formatMessage({ id: "settings.modelProvider.selfBalance.toppedUp" })}
          amount={balance.toppedUpBalance}
          currency={balance.currency}
          locale={locale}
        />
      </div>
    </div>
  );
}

function BalanceDetailRow({
  label,
  amount,
  currency,
  locale,
}: {
  label: string;
  amount: number;
  currency: string;
  locale: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-ui-xs text-foreground-subtle">{label}</span>
      <span className="shrink-0 text-ui-xs text-foreground-subtle">
        {formatBalanceAmount(locale, amount, currency)}
      </span>
    </div>
  );
}

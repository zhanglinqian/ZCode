/**
 * 使用统计页 tab id 的公共定义。
 *
 * 放在 lib 层而不是 settings 层：tab id 同时被 `lib/settingsNavigation.ts`（跳转意图）
 * 与 `settings/UsageStatsSection.tsx`（面板渲染）消费，放高一层会让 lib 反向依赖 settings。
 *
 * 供应商自带数据（MiniMax 套餐额度 / DeepSeek 账户余额）的 tab 用 providerId 区分，
 * 而不是按供应商名硬编码：两家供应商可各自占一个 tab 同时存在，
 * 同一家的多个自定义实例也不会互相顶掉。
 */

/** 供应商自带数据 tab 的 id 前缀。 */
export const PROVIDER_SELF_QUOTA_TAB_PREFIX = "providerSelfQuota:";

export type ProviderSelfQuotaTabId = `${typeof PROVIDER_SELF_QUOTA_TAB_PREFIX}${string}`;

export function createProviderSelfQuotaTabId(providerId: string): ProviderSelfQuotaTabId {
  return `${PROVIDER_SELF_QUOTA_TAB_PREFIX}${providerId}`;
}

export function isProviderSelfQuotaTabId(tab: string): tab is ProviderSelfQuotaTabId {
  return tab.startsWith(PROVIDER_SELF_QUOTA_TAB_PREFIX);
}

/** 从 tab id 取回 providerId；不是该类 tab 时返回 null。 */
export function parseProviderSelfQuotaTabId(tab: string): string | null {
  return isProviderSelfQuotaTabId(tab) ? tab.slice(PROVIDER_SELF_QUOTA_TAB_PREFIX.length) : null;
}

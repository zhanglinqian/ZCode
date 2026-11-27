import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";
import {
  CodingPlanUsagePanel,
  type CodingPlanUsageSource,
} from "@/settings/usage-stats/CodingPlanUsagePanel.js";
import { ProviderSelfQuotaSection } from "@/settings/model-provider-section/ProviderSelfQuotaSection.js";
import { ProviderSelfBalanceSection } from "@/settings/model-provider-section/ProviderSelfBalanceSection.js";
import {
  parseProviderSelfQuotaTabId,
  type ProviderSelfQuotaTabId,
} from "@/lib/settingsUsageTabs.js";

export type UsageStatsSectionTab =
  | "app"
  | "codingPlan"
  | `codingPlan:${string}`
  | ProviderSelfQuotaTabId;

/**
 * 供应商自带数据的种类。
 *
 * - quota：供应商侧下发的配额窗口（MiniMax 的 5 小时 / 周窗口），展示为百分比额度卡。
 * - balance：账户余额金额（DeepSeek 的 CNY / USD 余额），展示为金额卡片。
 */
export type UsageStatsSelfUsageKind = "quota" | "balance";

/** 使用统计供应商自带数据 tab 对应的供应商事实；由 SettingsPage 从 provider 视图解析。 */
export interface UsageStatsSelfUsageProvider {
  providerId: string;
  providerName: string;
  baseUrl: string | null;
  kind: UsageStatsSelfUsageKind;
}

export function UsageStatsSection({
  activeTab,
  providerSourcesLoading,
  workspaceIdentity,
  workspacePath,
  selectedCodingPlanSource,
  selfUsageProviders,
}: {
  activeTab: UsageStatsSectionTab;
  providerSourcesLoading: boolean;
  workspaceIdentity?: string;
  workspacePath?: string;
  selectedCodingPlanSource?: CodingPlanUsageSource | null;
  selfUsageProviders?: UsageStatsSelfUsageProvider[];
}) {
  if (activeTab === "app") {
    return <AppUsagePanel />;
  }

  const selfUsageProviderId = parseProviderSelfQuotaTabId(activeTab);
  if (selfUsageProviderId) {
    // tab 只在有可用供应商（端点命中且已填 Key）时渲染入口；
    // 数据未就绪时落到这里就直接不渲染，避免空面板闪现。
    const provider = selfUsageProviders?.find(
      (candidate) => candidate.providerId === selfUsageProviderId,
    );
    if (!provider) {
      return null;
    }
    return (
      <div className="space-y-4">
        <h3 className="text-ui-lg font-semibold text-foreground">
          {provider.providerName.trim() || provider.providerId}
        </h3>
        {provider.kind === "balance" ? (
          <ProviderSelfBalanceSection providerId={provider.providerId} baseUrl={provider.baseUrl} />
        ) : (
          <ProviderSelfQuotaSection providerId={provider.providerId} baseUrl={provider.baseUrl} />
        )}
      </div>
    );
  }

  return (
    <CodingPlanUsagePanel
      loadingSources={providerSourcesLoading}
      workspaceIdentity={workspaceIdentity}
      workspacePath={workspacePath}
      selectedSource={selectedCodingPlanSource}
    />
  );
}

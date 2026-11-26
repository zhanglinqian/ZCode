import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";
import {
  CodingPlanUsagePanel,
  type CodingPlanUsageSource,
} from "@/settings/usage-stats/CodingPlanUsagePanel.js";
import { ProviderSelfQuotaSection } from "@/settings/model-provider-section/ProviderSelfQuotaSection.js";

export type UsageStatsSectionTab = "app" | "minimax" | "codingPlan" | `codingPlan:${string}`;

/** 使用统计 MiniMax tab 对应的供应商事实；由 SettingsPage 从 provider 视图解析。 */
export interface UsageStatsMinimaxProvider {
  providerId: string;
  providerName: string;
  baseUrl: string | null;
}

export function UsageStatsSection({
  activeTab,
  providerSourcesLoading,
  workspaceIdentity,
  workspacePath,
  selectedCodingPlanSource,
  minimaxProvider,
}: {
  activeTab: UsageStatsSectionTab;
  providerSourcesLoading: boolean;
  workspaceIdentity?: string;
  workspacePath?: string;
  selectedCodingPlanSource?: CodingPlanUsageSource | null;
  minimaxProvider?: UsageStatsMinimaxProvider | null;
}) {
  if (activeTab === "app") {
    return <AppUsagePanel />;
  }

  if (activeTab === "minimax") {
    // tab 只在有可用 MiniMax provider（端点命中且已填 Key）时渲染入口；
    // 数据未就绪时落到这里就直接不渲染，避免空面板闪现。
    if (!minimaxProvider) {
      return null;
    }
    return (
      <div className="space-y-4">
        <h3 className="text-ui-lg font-semibold text-foreground">
          {minimaxProvider.providerName.trim() || "MiniMax"}
        </h3>
        <ProviderSelfQuotaSection
          providerId={minimaxProvider.providerId}
          baseUrl={minimaxProvider.baseUrl}
        />
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

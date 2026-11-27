/* 聊天 context 面板「供应商自带额度/余额」段的浏览器验收 fixture。
 *
 * 用 query 参数切换三种场景：
 *   ?kind=quota   → MiniMax 配额窗口（unit 3 五小时 / unit 6 每周）
 *   ?kind=balance → DeepSeek 账户余额（CNY 明细）
 *   ?kind=fail    → 服务层抛错（失败文案分支）
 * 面板 open 固定为 true：hook 挂载即经 mock 的 usageStatsService 拉取，
 * 验证真实的数据链路（RPC → 快照 → meter/金额行）而不只是静态props。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { IServiceAccessor } from "@zcode/services";
import type { UsageEntitlementSnapshot } from "@zcode/shared";
import { ZCodeIntlProvider, useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import {
  ChatProviderSelfUsagePanel,
  type ChatProviderSelfUsageConfig,
} from "@/chat-input-toolbar/ProviderSelfContextUsage.js";
import "@/styles.css";

const query = new URLSearchParams(location.search);
const kind = query.get("kind") ?? "quota";
document.documentElement.className =
  query.get("theme") === "light" ? "light theme-zai-light" : "dark theme-zai-dark";

const fiveHourReset = Date.now() + 2 * 60 * 60 * 1000;
const weeklyReset = Date.now() + 5 * 24 * 60 * 60 * 1000;

function quotaSnapshot(): UsageEntitlementSnapshot {
  return {
    generatedAt: Date.now(),
    authenticated: true,
    provider: { id: "minimax", name: "MiniMax" },
    remaining: null,
    subscription: null,
    quota: {
      level: null,
      limits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          percentage: 20,
          nextResetTime: fiveHourReset,
          usageDetails: [],
        },
        {
          type: "TOKENS_LIMIT",
          unit: 6,
          percentage: 0,
          nextResetTime: weeklyReset,
          usageDetails: [],
        },
      ],
    },
  };
}

function balanceSnapshot(): UsageEntitlementSnapshot {
  return {
    generatedAt: Date.now(),
    authenticated: true,
    provider: { id: "deepseek", name: "DeepSeek" },
    remaining: null,
    subscription: null,
    quota: null,
    providerBalance: {
      available: true,
      balances: [
        {
          currency: "CNY",
          totalBalance: 110,
          grantedBalance: 10,
          toppedUpBalance: 100,
        },
      ],
    },
  };
}

function ContextPanelFixture() {
  const { intl, locale } = useZCodeIntl();
  const config: ChatProviderSelfUsageConfig = {
    providerId: kind === "balance" ? "deepseek" : "minimax",
    providerName: kind === "balance" ? "DeepSeek" : "MiniMax",
    kind: kind === "balance" ? "balance" : "quota",
    onUsageClick: () => {
      window.dispatchEvent(new CustomEvent("fixture-usage-click"));
    },
  };
  return (
    <main className="min-h-screen bg-card p-6 text-foreground">
      <div className="w-80 rounded-xl border border-border bg-surface p-4">
        <ChatProviderSelfUsagePanel
          config={config}
          open
          intl={intl}
          locale={locale}
          separated={false}
        />
      </div>
      <output data-testid="click-marker" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ServiceProvider
      services={
        {
          usageStatsService: {
            getEntitlementSnapshot: async (): Promise<UsageEntitlementSnapshot> => {
              if (kind === "fail") {
                throw new Error("upstream unavailable");
              }
              // StrictMode 双挂载会让同一 provider 请求两次；模块级 TTL 缓存
              // 在面板 hook 内去重，这里按场景返回固定快照即可。
              return kind === "balance" ? balanceSnapshot() : quotaSnapshot();
            },
          },
        } as unknown as IServiceAccessor
      }
    >
      <TooltipProvider>
        <ZCodeIntlProvider initialLocale={query.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
          <ContextPanelFixture />
        </ZCodeIntlProvider>
      </TooltipProvider>
    </ServiceProvider>
  </StrictMode>,
);

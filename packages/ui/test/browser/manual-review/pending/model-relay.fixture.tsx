/**
 * 模型接力设置分区 fixture（浏览器验收，model-relay.test.mjs 配套）。
 *
 * 三个 hook 由 test 文件的 vite load 钩子替换为内存实现：
 * - useSettings：settings 存 module 级内存，update() 把每次写入推进 window.__modelRelayWrites
 * - useOptionalBaseWorkspaceServices：提供假的 usageStatsService（返回 5 小时额度快照）
 * - useProviderSettingsView：返回 ready 态的固定供应商视图
 */
import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ModelRelaySettingsSection } from "@/settings/model-relay/ModelRelaySettingsSection.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.className =
  params.get("theme") === "light" ? "light theme-zai-light" : "dark theme-zai-dark";

function App() {
  return (
    <ZCodeIntlProvider>
      <TooltipProvider>
        <div className="min-h-screen bg-background p-6">
          <ModelRelaySettingsSection />
        </div>
      </TooltipProvider>
    </ZCodeIntlProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

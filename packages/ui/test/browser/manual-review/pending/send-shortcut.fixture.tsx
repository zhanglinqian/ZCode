import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { IServiceAccessor } from "@zcode/services";
import type { AppSettings, IPlatformService } from "@zcode/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ShortcutSettingsSection } from "@/settings/ShortcutSettingsSection.js";
import { LexicalChatInput } from "@/LexicalChatInput.js";
import { TabStoreProvider } from "@/store/TabStoreProvider.js";
import { StoreProvider } from "@/store/StoreProvider.js";
import "@/styles.css";

let settings = JSON.parse(localStorage.getItem("send-shortcut-fixture") ?? "{}") as AppSettings;
const emptyService = new Proxy({}, { get: () => async () => [] });
const services = {
  settingService: {
    get: async () => settings,
    update: async (patch: Partial<AppSettings>) => {
      settings = { ...settings, ...patch };
      localStorage.setItem("send-shortcut-fixture", JSON.stringify(settings));
    },
  },
  broadcastService: { onMessage: () => () => {}, send: async () => {} },
  zcodeAgentService: emptyService,
  botsService: emptyService,
} as unknown as IServiceAccessor;

function Fixture() {
  const [sent, setSent] = useState(0);
  return (
    <>
      <div style={{ maxHeight: 360, overflow: "auto" }}>
        <ShortcutSettingsSection />
      </div>
      <LexicalChatInput
        workspacePath=""
        taskId={null}
        inputTestId="send-test-editor"
        enableMentionPanel={false}
        onSubmit={() => {
          setSent((value) => value + 1);
          return true;
        }}
      />
      <output data-testid="sent-count">{sent}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <PlatformProvider platform={{} as IPlatformService}>
    <ServiceProvider services={services}>
      <ZCodeIntlProvider initialLocale="en-US">
        <TooltipProvider>
          <StoreProvider broadcastService={services.broadcastService}>
            <TabStoreProvider>
              <Fixture />
            </TabStoreProvider>
          </StoreProvider>
        </TooltipProvider>
      </ZCodeIntlProvider>
    </ServiceProvider>
  </PlatformProvider>,
);

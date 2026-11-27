import { DesktopCommandIds } from "@zcode/shared";
import { useEffect, useState } from "react";
import { usePlatform } from "@/hooks/usePlatform.js";
import type { OfficialDataImportStatus as Status } from "./contract.js";

export function useOfficialDataImport(isDesktop: boolean) {
  const platform = usePlatform();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    void platform.executeDesktopCommand(DesktopCommandIds.OfficialDataImportStatus).then(
      (result) => {
        if (active) setStatus(result as Status | null);
      },
      () => {
        if (active) setStatus(null);
      },
    );
    return () => {
      active = false;
    };
  }, [isDesktop, platform]);

  async function execute(restore: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await platform.executeDesktopCommand(
        restore
          ? DesktopCommandIds.RestoreOfficialDataBackup
          : DesktopCommandIds.ImportOfficialData,
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return { status: isDesktop ? status : null, busy, failed, execute };
}

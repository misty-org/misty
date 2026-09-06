import type { PluginPanelEntry } from "@/native/contracts";
import { OFFICIAL_APP_IDS } from "@/api/apps";
import { pluginCommandsSnapshot } from "@/native/settings-plugins";
import { useEffect, useState } from "react";
import { pluginCatalogChangedEvent } from "./utils/pluginEvents";

export interface InstalledApp {
  id: string;
  name: string;
}

export function installedAppsFromPanels(panels: readonly PluginPanelEntry[]): InstalledApp[] {
  const apps = new Map<string, InstalledApp>();
  for (const panel of panels) {
    if (OFFICIAL_APP_IDS.has(panel.pluginId)) continue;
    if (!apps.has(panel.pluginId)) {
      apps.set(panel.pluginId, { id: panel.pluginId, name: panel.pluginName });
    }
  }
  return [...apps.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Enabled installed packages are standalone Apps until Misty gains host-bound extensions. */
export function useInstalledApps(): InstalledApp[] {
  const [apps, setApps] = useState<InstalledApp[]>([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const snapshot = await pluginCommandsSnapshot();
        if (!disposed) setApps(installedAppsFromPanels(snapshot.panels));
      } catch {
        if (!disposed) setApps([]);
      }
    };
    void load();
    window.addEventListener("focus", load);
    window.addEventListener(pluginCatalogChangedEvent, load);
    return () => {
      disposed = true;
      window.removeEventListener("focus", load);
      window.removeEventListener(pluginCatalogChangedEvent, load);
    };
  }, []);

  return apps;
}

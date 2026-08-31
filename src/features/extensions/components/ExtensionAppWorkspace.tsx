import type { WorkspaceTab } from "@/features/workspace";
import { ExplorerPluginPanelHost } from "@/features/files/explorer";
import type { PluginPanelEntry } from "@/native/contracts";
import { pluginCommandsSnapshot } from "@/native/settings-plugins";
import { Button, ErrorState } from "@/shared/ui";
import { RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pluginCatalogChangedEvent } from "../utils/pluginEvents";
import { parseExtensionAppRoute } from "../model/extensionAppRoute";

export function ExtensionAppWorkspace({ tab }: { tab: WorkspaceTab }) {
  const route = useMemo(() => parseExtensionAppRoute(tab.route), [tab.route]);
  const [panel, setPanel] = useState<PluginPanelEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!route) return;
    setLoading(true);
    setError("");
    try {
      const snapshot = await pluginCommandsSnapshot();
      const nextPanel =
        snapshot.panels.find(
          (candidate) => candidate.pluginId === route.pluginId && Boolean(candidate.webEntry),
        ) ?? snapshot.panels.find((candidate) => candidate.pluginId === route.pluginId);
      setPanel(nextPanel ?? null);
      if (!nextPanel) setError(`${route.title} is not installed, enabled, or ready to open.`);
    } catch (cause) {
      setPanel(null);
      setError(cause instanceof Error ? cause.message : `Could not open ${route.title}.`);
    } finally {
      setLoading(false);
    }
  }, [route]);

  useEffect(() => {
    void load();
    window.addEventListener(pluginCatalogChangedEvent, load);
    return () => window.removeEventListener(pluginCatalogChangedEvent, load);
  }, [load]);

  if (!route) {
    return (
      <ErrorState
        className="h-full"
        title="This app could not be opened"
        description="Open the app again from Store or the Apps menu."
      />
    );
  }

  if (loading) {
    return (
      <div className="grid h-full content-center justify-items-center gap-3 bg-charcoal-bg text-sm text-cream-muted">
        <RefreshCcw className="animate-spin" aria-hidden="true" size={20} />
        <span>Opening {route.title}…</span>
      </div>
    );
  }

  if (!panel || error) {
    return (
      <ErrorState
        className="h-full"
        title={`${route.title} could not be opened`}
        description={error || "Reinstall the app from Store and try again."}
        action={
          <Button onClick={() => void load()} size="sm" variant="outline">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div
      className="h-full min-h-0 overflow-hidden bg-charcoal-bg"
      data-extension-app={route.pluginId}
    >
      <ExplorerPluginPanelHost
        mode="app"
        panel={panel}
        selectedPath={route.selectedPaths[0] ?? ""}
      />
    </div>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Dims a browser pane's native page. The page sits above the app, so the pane's own dim
 * layer cannot cover it; the host lays a non-interactive layer over the page view
 * instead (never inside the page). The host remembers the strength, so a page created
 * later starts dimmed.
 */
export function useBrowserPaneDim(runtimeId: string | null, strength: number) {
  useEffect(() => {
    if (!runtimeId || !hasTauriInternals()) return;
    const apply = (value: number) =>
      void invoke("browser_webview_set_pane_dim", { id: runtimeId, strength: value }).catch(
        () => undefined,
      );
    apply(strength);
    return () => apply(0);
  }, [runtimeId, strength]);
}

import { useEffect } from "react";
import { closeOrphanAgentPages } from "@/features/browser";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Closes the agents' pages left from before this renderer loaded. Native pages outlive a reload,
 * but an agent's page from before it belongs to nothing here and would stay drawn where it was,
 * over whatever the window shows now.
 */
export function useStrayBrowserPages() {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    void closeOrphanAgentPages();
  }, []);
}

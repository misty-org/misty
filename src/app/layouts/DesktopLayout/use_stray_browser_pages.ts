import { useEffect } from "react";
import { closeOrphanAgentPages } from "@/features/browser";
import { hasTauriInternals } from "@/shared/platform/tauri";

export function useStrayBrowserPages() {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    void closeOrphanAgentPages();
  }, []);
}

import { useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  browserRuntimeResumeEvent,
  prepareBrowserPagePreview,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import { isHomePreviewTab, type ContinueItem } from "./useContinueItems";
import { readyHomePreview } from "./useHomePreviewItems";

/** Refill the session-only cache from open websites when Home becomes active. */
export function usePrepareHomePreviews(items: ContinueItem[], active: boolean, limit: number) {
  const [preparing, setPreparing] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const refresh = () => setGeneration((value) => value + 1);
    window.addEventListener(browserRuntimeResumeEvent, refresh);
    return () => window.removeEventListener(browserRuntimeResumeEvent, refresh);
  }, []);
  useEffect(() => {
    if (!active || !hasTauriInternals()) {
      setPreparing(false);
      return;
    }
    let cancelled = false;
    const candidates = items.filter(({ tab }) => isHomePreviewTab(tab));
    const readyCount = () => {
      const previews = useBrowserRuntimeStore.getState().previews;
      return candidates.filter(({ tab }) => readyHomePreview(tab, previews[tab.id])).length;
    };
    const prepare = async () => {
      setPreparing(candidates.length > 0 && readyCount() < Math.min(limit, candidates.length));
      try {
        // One capture at a time bounds native work. Never focus or navigate the real tabs.
        for (const { tab } of candidates) {
          if (cancelled || readyCount() >= limit) break;
          if (readyHomePreview(tab, useBrowserRuntimeStore.getState().previews[tab.id])) continue;
          await prepareBrowserPagePreview(tab, () => !cancelled).catch(() => undefined);
        }
      } finally {
        if (!cancelled) setPreparing(false);
      }
    };
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [active, generation, items, limit]);
  return preparing;
}

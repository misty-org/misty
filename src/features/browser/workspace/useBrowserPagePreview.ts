import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace";
import { useEffect, useRef, type RefObject } from "react";
import { captureBrowserPagePreview } from "./browserRuntime";

export function useBrowserPagePreview(
  tab: WorkspaceView,
  host: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const latest = useRef(tab);
  latest.current = tab;
  const { url, private: privateTab } = parseBrowserViewState(tab.state);
  useEffect(() => {
    if (!enabled || privateTab || !/^https?:\/\//i.test(url)) return;
    let disposed = false;
    const capture = () => {
      const element = host.current;
      if (!element?.isConnected || document.visibilityState === "hidden") return;
      const rect = element.getBoundingClientRect();
      const scale = getAppliedAppRenderScale();
      const width = Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left);
      const height = Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top);
      void captureBrowserPagePreview(
        latest.current,
        { width: Math.floor(width * scale), height: Math.floor(height * scale) },
        () => !disposed && parseBrowserViewState(latest.current.state).url === url,
      );
    };
    // Let the loaded page paint; refresh quietly while it is being used.
    const initial = window.setTimeout(capture, 1_500);
    const refresh = window.setInterval(capture, 15_000);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [enabled, host, privateTab, tab.id, tab.instanceKey, url]);
}

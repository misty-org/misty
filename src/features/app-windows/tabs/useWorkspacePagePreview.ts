import { useEffect, useRef, type RefObject } from "react";
import type { WorkspaceView } from "./workspaceViews";
import { snapshotPage } from "./pageSnapshot";
import { pagePreviewGeneration, savePagePreview } from "../page-runtime/browserPagePreview";
import { invoke } from "@tauri-apps/api/core";
import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";

/** Every page the window draws itself gets a real content preview. */
export function useWorkspacePagePreview(
  tab: WorkspaceView | undefined,
  host: RefObject<HTMLElement | null>,
  active: boolean,
) {
  const latest = useRef(tab);
  latest.current = tab;
  const url = tab?.route;
  const tabId = tab?.id;
  useEffect(() => {
    if (!tabId || !url || !active) return;
    let disposed = false;
    let capturing = false;
    const capture = async () => {
      const generation = pagePreviewGeneration();
      const root =
        host.current?.querySelector<HTMLElement>("[data-browser-page-host]") ?? host.current;
      if (
        !root?.isConnected ||
        document.visibilityState === "hidden" ||
        !root.clientWidth ||
        capturing
      )
        return;
      const documentPreview = snapshotPage(root);
      if (documentPreview && latest.current?.id === tabId) {
        savePagePreview(tabId, { url, document: documentPreview });
      } else if (import.meta.env.MISTY_NATIVE_MACOS_CAPTURE) {
        capturing = true;
        try {
          const rect = root.getBoundingClientRect();
          const scale = getAppliedAppRenderScale();
          const image = await invoke<{ dataUrl: string }>("host_webview_capture_region", {
            x: rect.x * scale,
            y: rect.y * scale,
            width: rect.width * scale,
            height: rect.height * scale,
            maxDimension: 2560,
          });
          if (
            !disposed &&
            generation === pagePreviewGeneration() &&
            latest.current?.id === tabId &&
            image.dataUrl.length <= 8_000_000
          ) {
            savePagePreview(tabId, { url, dataUrl: image.dataUrl });
          }
        } catch {
          /* The existing preview remains available. */
        } finally {
          capturing = false;
        }
      }
    };
    const initial = window.setTimeout(capture, 1000);
    const refresh = window.setInterval(capture, 15_000);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [active, host, tabId, url]);
}

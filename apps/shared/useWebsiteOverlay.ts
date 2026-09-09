import { useCallback, useEffect, useRef, useState } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import { useBrowserOverlay } from "@/features/browser/useBrowserOverlay";

type View = Awaited<ReturnType<MistyAppSDK["browser"]["create"]>>;

/** Use the Browser's native stacking handoff without hiding or recreating the page. */
export function useWebsiteOverlay(
  misty: MistyAppSDK,
  view: View | null,
  requested: boolean,
  active: boolean,
) {
  const handle = view?.handle;
  const currentHandle = useRef(handle);
  currentHandle.current = handle;
  const [readyHandle, setReadyHandle] = useState<string>();
  const setOverlay = useCallback(
    async (reason: string, enabled: boolean) => {
      if (handle) await misty.browser.overlay(handle, reason, enabled);
      if (enabled && currentHandle.current === handle) setReadyHandle(handle);
    },
    [misty, handle],
  );
  const overlay = useBrowserOverlay("website-panels", setOverlay);
  useEffect(() => {
    overlay.onOpenChange(requested && active);
  }, [requested, active, overlay.onOpenChange]);
  return (
    requested && active && (!handle || (overlay.open && readyHandle === handle))
  );
}

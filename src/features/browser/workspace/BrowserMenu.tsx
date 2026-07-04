import type { WorkspaceTab } from "@/features/workspace/model";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { invoke } from "@tauri-apps/api/core";
import {
  browserRuntimeId,
  useBrowserRuntimeStore,
  setBrowserWebviewsSuspended,
  browserOverlayReady,
} from "./browserRuntime";
import { BrowserMenuView } from "./BrowserMenuView";
import { useCallback } from "react";
export function BrowserMenu(props: {
  iconButtonClass: string;
  nativeRuntime: boolean;
  tab: WorkspaceTab;
  url: string;
}) {
  const setOverlay = useCallback(
    async (reason: string, active: boolean) => {
      setBrowserWebviewsSuspended(
        active,
        `browser-${reason}:${browserRuntimeId(props.tab)}`,
      );
      await browserOverlayReady();
    },
    [props.tab.instanceKey],
  );
  const reportError = (error: unknown) =>
    useBrowserRuntimeStore
      .getState()
      .setError(
        props.tab.id,
        error instanceof Error ? error.message : String(error),
      );
  return (
    <BrowserMenuView
      {...props}
      setOverlay={setOverlay}
      zoomId={props.nativeRuntime ? browserRuntimeId(props.tab) : undefined}
      setZoom={async (factor) => {
        await invoke("browser_webview_set_zoom", {
          request: { id: browserRuntimeId(props.tab), factor },
        });
      }}
      reportError={reportError}
      openExternal={openSystemExternalLink}

    />
  );
}

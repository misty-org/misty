import type { WorkspaceTab } from "@/features/workspace/model";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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
      setBrowserWebviewsSuspended(active, `browser-${reason}:${browserRuntimeId(props.tab)}`);
      await browserOverlayReady();
    },
    [props.tab.instanceKey],
  );
  const reportError = (error: unknown) =>
    useBrowserRuntimeStore
      .getState()
      .setError(props.tab.id, error instanceof Error ? error.message : String(error));
  return (
    <BrowserMenuView
      {...props}
      setOverlay={setOverlay}
      reportError={reportError}
      openExternal={openSystemExternalLink}
      reload={async () => {
        if (props.nativeRuntime)
          await invoke("browser_webview_reload", { request: { id: browserRuntimeId(props.tab) } });
      }}
      copyAddress={async () => {
        if (props.nativeRuntime) await writeText(props.url);
        else await navigator.clipboard.writeText(props.url);
        useBrowserRuntimeStore.getState().setNotice(props.tab.id, "Address copied.");
        window.setTimeout(
          () => useBrowserRuntimeStore.getState().setNotice(props.tab.id, null),
          2500,
        );
      }}
    />
  );
}

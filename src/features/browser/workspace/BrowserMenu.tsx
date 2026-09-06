import { settingsString, useSettingsStore } from "@/features/settings";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import {
  parseSiteZoomLevels,
  siteZoomKey,
  siteZoomPercent,
  siteZoomSettingWith,
} from "@/features/webviews/siteZoom";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { invoke } from "@tauri-apps/api/core";
import {
  browserRuntimeId,
  useBrowserRuntimeStore,
  setBrowserWebviewsSuspended,
  browserOverlayReady,
} from "./browserRuntime";
import { BrowserMenuView } from "./BrowserMenuView";
import { useCallback, useMemo, type ReactNode } from "react";
import type { BrowserPageCommands } from "./useBrowserPageCommands";
export function BrowserMenu(props: {
  nativeRuntime: boolean;
  tab: WorkspaceView;
  url: string;
  commands?: BrowserPageCommands;
  tools?: ReactNode;
}) {
  const runtimeId = browserRuntimeId(props.tab);
  const privateTab = Boolean(parseBrowserViewState(props.tab.state).private);
  const siteZoomRaw = useSettingsStore((state) =>
    settingsString(state.settings?.document ?? {}, "general", "browser_site_zoom_json", "[]"),
  );
  const siteLevels = useMemo(() => parseSiteZoomLevels(siteZoomRaw), [siteZoomRaw]);
  // Private tabs zoom only themselves and never save a level.
  const remembered =
    privateTab || !siteZoomKey(props.url) ? undefined : siteZoomPercent(siteLevels, props.url);
  const setOverlay = useCallback(
    async (reason: string, active: boolean) => {
      setBrowserWebviewsSuspended(active, `browser-${reason}:${runtimeId}`);
      await browserOverlayReady();
    },
    [runtimeId],
  );
  const reportError = (error: unknown) =>
    useBrowserRuntimeStore
      .getState()
      .setError(props.tab.id, error instanceof Error ? error.message : String(error));
  return (
    <BrowserMenuView
      {...props}
      setOverlay={setOverlay}
      zoomId={
        props.nativeRuntime
          ? `${runtimeId}|${privateTab ? "" : (siteZoomKey(props.url) ?? "")}`
          : undefined
      }
      zoomPercent={remembered}
      app={{
        title: props.tab.title,
        bookmarkId: parseBrowserViewState(props.tab.state).bookmarkId,
        installable: !privateTab && /^https?:\/\//i.test(props.url),
      }}
      setZoom={async (factor) => {
        await invoke("browser_webview_set_zoom", { request: { id: runtimeId, factor } });
        if (privateTab) return;
        const settings = useSettingsStore.getState();
        const raw = settingsString(
          settings.settings?.document ?? {},
          "general",
          "browser_site_zoom_json",
          "[]",
        );
        const next = siteZoomSettingWith(raw, props.url, factor);
        if (next !== null && next !== raw)
          settings.updateSetting("general", "browser_site_zoom_json", next);
      }}
      reportError={reportError}
      openExternal={openSystemExternalLink}
    />
  );
}

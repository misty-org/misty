import { settingsString, useSettingsStore } from "@/features/settings";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { parseSiteZoomLevels, siteZoomKey, siteZoomPercent } from "@/features/webviews/siteZoom";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import {
  browserRuntimeId,
  useBrowserRuntimeStore,
  setBrowserWebviewsSuspended,
  browserOverlayReady,
} from "@/features/webviews/browserRuntime";
import { BrowserMenuView } from "./BrowserMenuView";
import { useCallback, useMemo, type ReactNode } from "react";
import type { BrowserPageCommands } from "./useBrowserPageCommands";
import { isIncognitoWindow } from "@/features/workspace/profileWindow";
import { setPageZoom, usePrivatePageZoom } from "./pageZoom";
export function BrowserMenu(props: {
  nativeRuntime: boolean;
  tab: WorkspaceView;
  url: string;
  commands?: BrowserPageCommands;
  tools?: ReactNode;
  layout?: ReactNode;
  lead?: ReactNode;
  toolsIcon?: boolean;
  library?: ReactNode;
}) {
  const runtimeId = browserRuntimeId(props.tab);
  const privateTab = Boolean(isIncognitoWindow());
  const siteZoomRaw = useSettingsStore((state) =>
    settingsString(state.settings?.document ?? {}, "general", "browser_site_zoom_json", "[]"),
  );
  const siteLevels = useMemo(() => parseSiteZoomLevels(siteZoomRaw), [siteZoomRaw]);
  // Private tabs zoom only themselves and never save a level.
  const privateLevel = usePrivatePageZoom((state) => state.levels[runtimeId]);
  const remembered = privateTab
    ? privateLevel
    : siteZoomKey(props.url)
      ? siteZoomPercent(siteLevels, props.url)
      : undefined;
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
      setZoom={(factor) => setPageZoom(runtimeId, props.url, privateTab, factor)}
      reportError={reportError}
      openExternal={openSystemExternalLink}
    />
  );
}

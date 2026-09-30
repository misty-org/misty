import { useMemo, type ComponentProps } from "react";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import {
  browserRuntimeId,
  browserOverlayReady,
  setBrowserWebviewsSuspended,
} from "./browserRuntime";
import { BrowserOmniboxView, type OmniboxContext } from "./BrowserOmniboxView";
import { forgetBrowserPage, markBrowserNavigationTyped } from "../library/historyRecorder";
import { createOmniboxProviders } from "./omnibox/providers";
import { liveOmniboxDeps } from "./omnibox/liveDeps";
export * from "./BrowserOmniboxView";

const setOverlay = async (reason: string, active: boolean) => {
  setBrowserWebviewsSuspended(active, reason);
  await browserOverlayReady();
};

// Providers read their sources at query time, so one set serves every tab.
const providers = createOmniboxProviders(liveOmniboxDeps);

export function BrowserOmnibox(
  props: Omit<
    ComponentProps<typeof BrowserOmniboxView>,
    | "suspensionReason"
    | "setOverlay"
    | "context"
    | "providers"
    | "onNavigate"
    | "onSwitchView"
    | "onOpenInApp"
    | "onRemove"
  > & {
    tab: WorkspaceView;
    historyEntries: string[];
    onNavigate: (value: string) => void;
  },
) {
  const { profileId, private: isPrivate } = parseBrowserViewState(props.tab.state);
  // Keyed on content: callers may pass a fresh array each render, and a new
  // context would rerun every provider.
  const sessionHistoryKey = props.historyEntries.join("\n");
  const context = useMemo<OmniboxContext>(
    () => ({
      tabId: props.tab.id,
      profileId,
      private: Boolean(isPrivate),
      sessionHistory: sessionHistoryKey ? sessionHistoryKey.split("\n") : [],
    }),
    [isPrivate, profileId, sessionHistoryKey, props.tab.id],
  );
  return (
    <BrowserOmniboxView
      currentUrl={props.currentUrl}
      compact={props.compact}
      pageTitle={props.pageTitle}
      focusRequest={props.focusRequest}
      context={context}
      providers={providers}
      suspensionReason={`browser-omnibox:${browserRuntimeId(props.tab)}`}
      setOverlay={setOverlay}
      onNavigate={(value, { typed }) => {
        // Only web pages are recorded, so only they may claim the mark.
        if (typed && /^https?:\/\//i.test(value)) markBrowserNavigationTyped(props.tab.id);
        props.onNavigate(value);
      }}
      onSwitchView={(tabId) => useWorkspaceStore.getState().focusView(tabId)}
      onOpenInApp={(route) => {
        // Opens the item in its tool's tab, moving an open one to it.
        const surface = workspaceSurfaceFromRoute(route);
        if (!surface) return;
        const opened = useWorkspaceStore
          .getState()
          .openSurface({ ...surface, syncExistingRoute: true });
        useWorkspaceStore.getState().focusView(opened.id);
      }}
      onRemove={(match) => forgetBrowserPage(props.tab.id, match.target.url)}
    />
  );
}

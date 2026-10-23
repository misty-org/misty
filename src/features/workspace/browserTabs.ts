import { activeLayoutView, allLayoutViews } from "./layoutTabs";
import { parseBrowserViewState } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { currentWindows } from "./windows";
import { isIncognitoWindow } from "./spaceWindow";

export interface OpenBrowserTab {
  tabId: string;
  url: string;
  title: string;
  profileId?: string;
  private: boolean;
  agentOwned: boolean;
  faviconUrl?: string | null;
}

/** Browser tabs in every window: the same ones `focusView` can switch to. */
export function openBrowserTabs(): OpenBrowserTab[] {
  return currentWindows(useWorkspaceStore.getState())
    .flatMap((window) => allLayoutViews(window.layout))
    .filter((tab) => tab.surfaceId === "browser")
    .map((tab) => {
      const state = parseBrowserViewState(tab.state);
      return {
        tabId: tab.id,
        url: state.url,
        title: tab.title,
        profileId: state.profileId,
        private: isIncognitoWindow(),
        agentOwned: Boolean(state.agentOwned),
        faviconUrl: state.faviconUrl,
      };
    });
}

/** The focused browser tab's profile and privacy, or none when another surface is focused. */
export function activeBrowserTabContext(): {
  tabId: string;
  profileId?: string;
  private: boolean;
} | null {
  const view = activeLayoutView(useWorkspaceStore.getState().layout);
  if (view?.surfaceId !== "browser") return null;
  const state = parseBrowserViewState(view.state);
  return { tabId: view.id, profileId: state.profileId, private: isIncognitoWindow() };
}

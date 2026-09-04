import { allLayoutViews } from "./layoutTabs";
import { parseBrowserViewState } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { currentWindows } from "./windows";

export interface OpenBrowserTab {
  tabId: string;
  url: string;
  title: string;
  profileId?: string;
  private: boolean;
  agentOwned: boolean;
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
        private: Boolean(state.private),
        agentOwned: Boolean(state.agentOwned),
      };
    });
}

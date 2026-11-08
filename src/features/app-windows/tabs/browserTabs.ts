import { activeLayoutView, allLayoutViews } from "../panes/layoutTabs";
import { parseBrowserViewState } from "./workspaceViews";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { currentWindows } from "../profiles/windows";
import { isIncognitoWindow } from "../profiles/profileWindow";

interface OpenBrowserTab {
  tabId: string;
  url: string;
  title: string;
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
        private: isIncognitoWindow(),
        agentOwned: Boolean(state.agentOwned),
        faviconUrl: state.faviconUrl,
      };
    });
}

/** The focused browser tab and its privacy, or none when another surface is focused. */
export function activeBrowserTabContext(): {
  tabId: string;
  private: boolean;
} | null {
  const view = activeLayoutView(useWorkspaceStore.getState().layout);
  if (view?.surfaceId !== "browser") return null;
  return { tabId: view.id, private: isIncognitoWindow() };
}

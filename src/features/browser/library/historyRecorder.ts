import {
  isBrowserInternalUrl,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { mapAllWorkspaceWindowViews } from "@/features/workspace/windows";
import { browserLibrary } from "./native";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";

/** Finds a tab in any virtual window or Space, active or not. */
function findWorkspaceView(tabId: string): WorkspaceView | null {
  let found: WorkspaceView | null = null;
  mapAllWorkspaceWindowViews(useWorkspaceStore.getState(), (tab) => {
    if (!found && tab.id === tabId) found = tab;
    return tab;
  });
  return found;
}

/**
 * History belongs to the person browsing: private tabs, pages an agent opens
 * for its own work, and Misty's own pages are left out.
 */
function historyTarget(tabId: string): { profileId?: string } | null {
  const tab = findWorkspaceView(tabId);
  if (!tab) return null;
  const state = parseBrowserViewState(tab.state);
  if (state.agentOwned || isIncognitoWindow() || isBrowserInternalUrl(state.url)) return null;
  return { profileId: state.profileId };
}
/**
 * Records a finished page load as a visit, so the address bar's recent pages and history
 * have something to show. The title usually arrives later and updates this visit.
 */
export function recordBrowserVisit(tabId: string, url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const target = historyTarget(tabId);
  if (!target) return;
  const tab = findWorkspaceView(tabId);
  const title = tab?.title ?? "";
  void browserLibrary.recordVisit({ ...target, url, title }).catch(() => undefined);
}

export function recordBrowserVisitTitle(tabId: string, url: string, title: string): void {
  if (!/^https?:\/\//i.test(url) || !title.trim()) return;
  const target = historyTarget(tabId);
  if (!target) return;
  void browserLibrary.setVisitTitle({ ...target, url, title }).catch(() => undefined);
}

export function browserViewUrl(tabId: string): string | null {
  const tab = findWorkspaceView(tabId);
  return tab ? parseBrowserViewState(tab.state).url : null;
}

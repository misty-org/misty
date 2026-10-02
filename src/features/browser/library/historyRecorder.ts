import {
  isBrowserInternalUrl,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { mapAllWorkspaceWindowViews } from "@/features/workspace/windows";
import { browserLibrary } from "./native";

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
  if (state.agentOwned || state.private || isBrowserInternalUrl(state.url)) return null;
  return { profileId: state.profileId };
}
const typedNavigations = new Map<string, number>();

/** Marks the tab's next visit as typed by the person, which ranks it higher in the address bar. */
export function markBrowserNavigationTyped(tabId: string): void {
  typedNavigations.set(tabId, Date.now());
}

/** Removes a page from the tab's profile history. Private and agent tabs have none. */
export function forgetBrowserPage(tabId: string, url: string): Promise<void> {
  const target = historyTarget(tabId);
  return target ? browserLibrary.forgetPage({ ...target, url }) : Promise.resolve();
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

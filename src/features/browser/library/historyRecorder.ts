import {
  isBrowserInternalUrl,
  parseBrowserTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import { mapAllVirtualWorkspaceTabs } from "@/features/workspace/virtualWindows";
import { browserLibrary } from "./native";

/** Finds a tab in any virtual window or Space, active or not. */
function findWorkspaceTab(tabId: string): WorkspaceTab | null {
  let found: WorkspaceTab | null = null;
  mapAllVirtualWorkspaceTabs(useWorkspaceStore.getState(), (tab) => {
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
  const tab = findWorkspaceTab(tabId);
  if (!tab) return null;
  const state = parseBrowserTabState(tab.state);
  if (state.agentOwned || state.private || isBrowserInternalUrl(state.url)) return null;
  return { profileId: state.profileId };
}

/** A typed navigation is claimed by the tab's next recorded visit, after any redirects. */
const TYPED_NAVIGATION_WINDOW_MS = 30_000;
const typedNavigations = new Map<string, number>();

/** Marks the tab's next visit as typed by the person, which ranks it higher in the address bar. */
export function markBrowserNavigationTyped(tabId: string): void {
  typedNavigations.set(tabId, Date.now());
}

function claimTypedNavigation(tabId: string): boolean {
  const markedAt = typedNavigations.get(tabId);
  typedNavigations.delete(tabId);
  return markedAt !== undefined && Date.now() - markedAt <= TYPED_NAVIGATION_WINDOW_MS;
}

export function recordBrowserVisit(tabId: string, url: string, title: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const typed = claimTypedNavigation(tabId);
  const target = historyTarget(tabId);
  if (!target) return;
  void browserLibrary.recordVisit({ ...target, url, title, typed }).catch(() => undefined);
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

export function browserTabUrl(tabId: string): string | null {
  const tab = findWorkspaceTab(tabId);
  return tab ? parseBrowserTabState(tab.state).url : null;
}

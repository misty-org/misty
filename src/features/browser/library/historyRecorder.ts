import { isBrowserInternalUrl } from "@/features/app-windows";
import {
  isUnseenPreload,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { allLayoutViews } from "@/features/app-windows";
import { browserLibrary } from "./native";
import { isIncognitoWindow } from "@/features/app-windows";

/** Finds a tab of this window, active or not. */
function findWorkspaceView(tabId: string): WorkspaceView | null {
  const views = allLayoutViews(useWorkspaceStore.getState().layout);
  return views.find((tab) => tab.id === tabId) ?? null;
}

/**
 * History belongs to the person browsing: private tabs, pages an agent opens
 * for its own work, pages loaded ahead of being opened, and Misty's own pages
 * are left out.
 */
function belongsInHistory(tabId: string): boolean {
  const tab = findWorkspaceView(tabId);
  if (!tab) return false;
  const state = parseBrowserViewState(tab.state);
  return (
    !state.agentOwned &&
    !isIncognitoWindow() &&
    !isBrowserInternalUrl(state.url) &&
    !isUnseenPreload(tabId)
  );
}
/**
 * Records a finished page load as a visit, so the address bar's recent pages and history
 * have something to show. The title usually arrives later and updates this visit.
 */
export function recordBrowserVisit(tabId: string, url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (!belongsInHistory(tabId)) return;
  const title = findWorkspaceView(tabId)?.title ?? "";
  void browserLibrary.recordVisit({ url, title }).catch(() => undefined);
}

export function recordBrowserVisitTitle(tabId: string, url: string, title: string): void {
  if (!/^https?:\/\//i.test(url) || !title.trim()) return;
  if (!belongsInHistory(tabId)) return;
  void browserLibrary.setVisitTitle({ url, title }).catch(() => undefined);
}

export function browserViewUrl(tabId: string): string | null {
  const tab = findWorkspaceView(tabId);
  return tab ? parseBrowserViewState(tab.state).url : null;
}

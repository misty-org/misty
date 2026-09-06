import { bookmarksBarId, bookmarkTree } from "@/features/bookmarks/library";
import { bookmarkLocation, searchBookmarks } from "@/features/bookmarks/search";
import { bookmarkWindowViews, browserLibrary, useBrowserDownloadsStore } from "@/features/browser";
import { browserInternalUrl, useWorkspaceStore } from "@/features/workspace";
import { openBrowserTabs } from "@/features/workspace/browserTabs";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { resultLimit, type ScopedSearchResult } from "../scopedSearchSources";

const recentLimit = 8;

function contains(text: string, query: string): boolean {
  return text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

function host(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function openPage(
  id: string,
  title: string,
  page: Parameters<typeof browserInternalUrl>[0],
): ScopedSearchResult {
  const url = browserInternalUrl(page);
  return { id, kind: "action", title, subtitle: url, target: { kind: "url", url } };
}

export function searchBookmarkLibrary(query: string): ScopedSearchResult[] {
  const state = useWorkspaceStore.getState();
  const tree = bookmarkTree(state.bookmarkFolders, state.bookmarks);
  const toResult = (bookmark: (typeof tree.bookmarks)[number]): ScopedSearchResult => ({
    id: `bookmark:${bookmark.id}`,
    kind: "bookmark",
    title: bookmark.title || host(bookmark.url),
    subtitle: bookmarkLocation(tree, bookmark) || host(bookmark.url),
    target: { kind: "url", url: bookmark.url },
  });
  if (query.trim()) return searchBookmarks(tree, query).slice(0, resultLimit).map(toResult);
  const bar = tree
    .children(bookmarksBarId)
    .flatMap((node) => (node.kind === "bookmark" ? [node] : []));
  return [
    openPage("bookmarks:manager", "Open bookmark manager", "bookmarks"),
    {
      id: "bookmarks:all-tabs",
      kind: "action",
      title: "Bookmark all tabs",
      subtitle: "Save this window's pages to a new folder",
      target: {
        kind: "run",
        run: () => {
          const saved = bookmarkWindowViews();
          return saved
            ? `Saved ${saved.count} ${saved.count === 1 ? "tab" : "tabs"} to “${saved.group}”.`
            : "There are no web pages in this window to bookmark.";
        },
      },
    },
    ...bar.slice(0, resultLimit - 2).map(toResult),
  ];
}

function closedTabs(query: string): ScopedSearchResult[] {
  return useWorkspaceStore
    .getState()
    .closedItems.map((closed, index) => ({ closed, index }))
    .filter(({ closed }) => !query.trim() || contains(closed.view.title, query))
    .slice(0, recentLimit)
    .map(({ closed, index }) => ({
      id: `closed:${closed.view.id}:${index}`,
      kind: "closed-tab",
      title: closed.view.title || "Untitled",
      subtitle: "Recently closed",
      target: {
        kind: "run",
        run: () => {
          // The reopened tab is focused; the canvas then follows it to its route.
          if (useWorkspaceStore.getState().reopenClosedView(index))
            window.dispatchEvent(new Event("misty:workspace-projection-applied"));
        },
      },
    }));
}

export async function searchBrowserHistory(query: string): Promise<ScopedSearchResult[]> {
  if (!query.trim())
    return [openPage("history:page", "Open history", "history"), ...closedTabs("")];
  const visits = hasTauriInternals()
    ? await browserLibrary.history({ text: query.trim(), limit: resultLimit * 2 }).catch(() => [])
    : [];
  // Visits repeat per page; keep the most recent one.
  const latest = new Map<string, (typeof visits)[number]>();
  for (const visit of visits)
    if ((latest.get(visit.url)?.visitedAt ?? -1) < visit.visitedAt) latest.set(visit.url, visit);
  const pages = [...latest.values()]
    .sort((left, right) => right.visitedAt - left.visitedAt)
    .map<ScopedSearchResult>((visit) => ({
      id: `history:${visit.url}`,
      kind: "history",
      title: visit.title || host(visit.url),
      subtitle: host(visit.url),
      target: { kind: "url", url: visit.url },
    }));
  return [...pages, ...closedTabs(query)].slice(0, resultLimit);
}

/** Agent-owned tabs belong to their run and are left out, as in the address bar. */
export function searchOpenTabs(query: string): ScopedSearchResult[] {
  return (
    openBrowserTabs()
      .filter((tab) => !tab.agentOwned)
      .filter((tab) => !query.trim() || contains(`${tab.title} ${tab.url}`, query))
      // Tab search lists every match so any open tab is one keystroke away.
      .map((tab) => ({
        id: `tab:${tab.tabId}`,
        kind: "tab",
        title: tab.title || host(tab.url),
        subtitle: tab.private ? `Private · ${host(tab.url)}` : host(tab.url),
        target: { kind: "tab", tabId: tab.tabId },
      }))
  );
}

export function searchDownloads(query: string): ScopedSearchResult[] {
  const store = useBrowserDownloadsStore.getState();
  if (!store.loaded && hasTauriInternals()) void store.refresh();
  const entries = [...store.entries]
    .sort((left, right) => right.startedAt - left.startedAt)
    .filter((entry) => !query.trim() || contains(`${entry.fileName} ${entry.url}`, query))
    .slice(0, query.trim() ? resultLimit : recentLimit)
    .map<ScopedSearchResult>((entry) => {
      const openable = entry.state === "finished" && entry.exists;
      return {
        id: `download:${entry.id}`,
        kind: "download",
        title: entry.fileName,
        subtitle: openable
          ? host(entry.url)
          : entry.state === "in_progress"
            ? "Downloading"
            : "Not available",
        target: openable
          ? {
              kind: "run",
              run: () => void browserLibrary.openDownload(entry.id).catch(() => undefined),
            }
          : { kind: "url", url: browserInternalUrl("downloads") },
      };
    });
  return query.trim()
    ? entries
    : [openPage("downloads:page", "Open downloads", "downloads"), ...entries];
}

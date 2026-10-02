/** Workspace state saved before the Window → Tab → Pane → View naming used old
 * field names: a pane held `tabs` (now `views`), a layout's active tab was
 * `activeLayoutTabId`, and windows were "virtual windows". This rewrites those
 * names anywhere in a persisted value. Current data passes through unchanged,
 * so every load path can call it. */

/** Store and snapshot keys, renamed at the top level only. */
const ROOT_KEYS: Record<string, string> = {
  virtualWindowsByScope: "windowsByScope",
  activeVirtualWindowIdByScope: "activeWindowIdByScope",
  activeVirtualWindowId: "activeWindowId",
  closedVirtualWindowsByScope: "closedWindowsByScope",
  closedTabs: "closedItems",
  lastUsedTabByGroup: "lastUsedViewByGroup",
  websiteGroups: "bookmarkFolders",
  savedWebsites: "bookmarks",
  expandedWebsiteGroups: "expandedBookmarkFolders",
  selectedWebsiteByGroup: "selectedBookmarkByFolder",
  virtualWindows: "windows",
};

type Plain = Record<string, unknown>;

function rename(object: Plain, from: string, to: string) {
  if (from in object && !(to in object)) {
    object[to] = object[from];
    delete object[from];
  }
}

function upgradeObject(object: Plain): Plain {
  const next: Plain = { ...object };
  // A pane (dock leaf) and the views it holds.
  if (next.type === "leaf" && "tabs" in next && !("views" in next)) {
    rename(next, "tabs", "views");
    rename(next, "activeTabId", "activeViewId");
  }
  // A window's layout and its active tab.
  rename(next, "activeLayoutTabId", "activeTabId");
  // A closed item: the view that closed and, for a closed tab, the tab.
  if ("windowId" in next && "paneId" in next && !("view" in next) && "tab" in next) {
    rename(next, "tab", "view");
    rename(next, "layoutTab", "tab");
    rename(next, "layoutTabId", "tabId");
  }
  // A browser view's state: the bookmark it was opened from.
  if (next.version === 1 && typeof next.url === "string" && "faviconUrl" in next)
    rename(next, "websiteId", "bookmarkId");
  for (const [key, value] of Object.entries(next)) next[key] = upgrade(value);
  return next;
}

function upgrade(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgrade);
  if (value && typeof value === "object") return upgradeObject(value as Plain);
  return value;
}

export function upgradeWorkspaceShape<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return upgrade(value) as T;
  const root: Plain = { ...(value as Plain) };
  for (const [from, to] of Object.entries(ROOT_KEYS)) rename(root, from, to);
  return upgradeObject(root) as T;
}

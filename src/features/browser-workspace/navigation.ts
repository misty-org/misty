import {
  allLayoutViews,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { resolveDirectAddress } from "./address";
import type { SharedRecord } from "./model";

function title(value: string): string {
  const result = value.trim();
  if (!result || result.length > 160) throw new Error("Use a name between 1 and 160 characters.");
  return result;
}
export function bookmarkAddress(input: string): string {
  const direct = resolveDirectAddress(input.trim());
  if (!direct) throw new Error("Enter a website address, such as example.com.");
  const url = new URL(direct);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use an http or https website address.");
  if (url.username || url.password)
    throw new Error("Save the website address without a username or password.");
  return url.href;
}
export function createBookmarkFolder(label: string): string {
  const state = useWorkspaceStore.getState();
  const id = `folder:${crypto.randomUUID()}`;
  const group: SharedRecord<"folder"> = {
    kind: "folder",
    id,
    fields: {
      label: title(label),
      icon: "globe",
      order: Math.max(-1, ...state.bookmarkFolders.map((item) => item.fields.order)) + 1,
      hidden: false,
    },
  };
  useWorkspaceStore.setState({
    bookmarkFolders: [...state.bookmarkFolders, group],
    expandedBookmarkFolders: { ...state.expandedBookmarkFolders, [id]: true },
  });
  return id;
}
export function renameBookmarkFolder(id: string, label: string): void {
  const name = title(label);
  useWorkspaceStore.setState((state) => ({
    bookmarkFolders: state.bookmarkFolders.map((group) =>
      group.id === id ? { ...group, fields: { ...group.fields, label: name } } : group,
    ),
  }));
}
export function reorderBookmarkFolders(ids: string[]): void {
  const { bookmarkFolders: websiteGroups } = useWorkspaceStore.getState();
  if (
    ids.length !== websiteGroups.length ||
    new Set(ids).size !== ids.length ||
    websiteGroups.some((group) => !ids.includes(group.id))
  )
    throw new Error("The website groups changed. Try reordering again.");
  useWorkspaceStore.setState({
    bookmarkFolders: ids.map((id, order) => {
      const group = websiteGroups.find((group) => group.id === id)!;
      return { ...group, fields: { ...group.fields, order } };
    }),
  });
}
export function addBookmark(groupId: string, label: string, address: string): string {
  const state = useWorkspaceStore.getState();
  if (!state.bookmarkFolders.some((group) => group.id === groupId))
    throw new Error("Choose an existing group.");
  const url = bookmarkAddress(address);
  const id = `bookmark:${crypto.randomUUID()}`;
  const website: SharedRecord<"bookmark"> = {
    kind: "bookmark",
    id,
    fields: {
      folder_id: groupId,
      title: title(label || new URL(url).hostname),
      url,
      pinned: true,
      order:
        Math.max(
          -1,
          ...state.bookmarks
            .filter((website) => website.fields.folder_id === groupId)
            .map((website) => website.fields.order),
        ) + 1,
    },
  };
  useWorkspaceStore.setState({
    bookmarks: [...state.bookmarks, website],
    selectedBookmarkByFolder: { ...state.selectedBookmarkByFolder, [groupId]: id },
    expandedBookmarkFolders: { ...state.expandedBookmarkFolders, [groupId]: true },
  });
  return id;
}
export function pinBookmark(id: string, pinned: boolean): void {
  useWorkspaceStore.setState((state) => ({
    bookmarks: state.bookmarks.map((website) =>
      website.id === id ? { ...website, fields: { ...website.fields, pinned } } : website,
    ),
  }));
}
export function removeBookmark(id: string): void {
  useWorkspaceStore.setState((state) => ({
    bookmarks: state.bookmarks.filter((website) => website.id !== id),
  }));
}
export function expandBookmarkFolder(id: string, open: boolean): void {
  useWorkspaceStore.setState((state) => ({
    expandedBookmarkFolders: { ...state.expandedBookmarkFolders, [id]: open },
  }));
}
/** Saved launch addresses never follow a tab's later page navigation. An ordinary
 * click resumes an existing view in this window; explicit new-tab opens duplicate. */
export function openBookmark(id: string, newTab = false): WorkspaceView {
  const state = useWorkspaceStore.getState();
  const website = state.bookmarks.find((website) => website.id === id);
  if (!website) throw new Error("This saved website is no longer available.");
  state.setScope("global");
  const current = useWorkspaceStore.getState();
  const existing =
    !newTab &&
    allLayoutViews(current.layout).find(
      (tab) => tab.surfaceId === "browser" && parseBrowserViewState(tab.state).bookmarkId === id,
    );
  let opened: WorkspaceView;
  if (existing) {
    current.focusView(existing.id);
    opened = existing;
  } else {
    opened = current.openBrowserView({ url: website.fields.url, bookmarkId: id });
  }
  useWorkspaceStore.setState((next) => ({
    selectedBookmarkByFolder: { ...next.selectedBookmarkByFolder, [website.fields.folder_id]: id },
    expandedBookmarkFolders: { ...next.expandedBookmarkFolders, [website.fields.folder_id]: true },
  }));
  return opened;
}

/** Apply a reviewed group draft in one state update, including its contents. */
export function saveBookmarkFolder(
  groupId: string | undefined,
  label: string,
  icon: string,
  sites: { title: string; url: string }[],
): string {
  const name = title(label);
  const normalized = sites.map((site) => ({
    title: title(site.title),
    url: bookmarkAddress(site.url),
  }));
  const state = useWorkspaceStore.getState();
  const existing = state.bookmarkFolders.find((group) => group.id === groupId);
  if (groupId && !existing) throw new Error("This group was removed. Choose another group.");
  const id = existing?.id ?? `folder:${crypto.randomUUID()}`;
  const urls = new Set<string>();
  const contents = normalized
    .filter((site) => {
      if (urls.has(site.url)) return false;
      urls.add(site.url);
      return true;
    })
    .map((site, order): SharedRecord<"bookmark"> => {
      const saved = state.bookmarks.find(
        (item) => item.fields.folder_id === id && item.fields.url === site.url,
      );
      return {
        kind: "bookmark",
        id: saved?.id ?? `bookmark:${crypto.randomUUID()}`,
        fields: { folder_id: id, title: site.title, url: site.url, pinned: true, order },
      };
    });
  const group: SharedRecord<"folder"> = {
    kind: "folder",
    id,
    fields: {
      label: name,
      icon,
      hidden: false,
      order:
        existing?.fields.order ??
        Math.max(-1, ...state.bookmarkFolders.map((item) => item.fields.order)) + 1,
    },
  };
  const selection = { ...state.selectedBookmarkByFolder };
  if (!contents.some((site) => site.id === selection[id])) {
    delete selection[id];
    if (contents[0]) selection[id] = contents[0].id;
  }
  useWorkspaceStore.setState({
    bookmarkFolders: existing
      ? state.bookmarkFolders.map((item) => (item.id === id ? group : item))
      : [...state.bookmarkFolders, group],
    bookmarks: [...state.bookmarks.filter((site) => site.fields.folder_id !== id), ...contents],
    selectedBookmarkByFolder: selection,
    expandedBookmarkFolders: { ...state.expandedBookmarkFolders, [id]: true },
  });
  return id;
}
export function removeBookmarkFolder(id: string): void {
  useWorkspaceStore.setState((state) => {
    const expanded = { ...state.expandedBookmarkFolders };
    const selected = { ...state.selectedBookmarkByFolder };
    delete expanded[id];
    delete selected[id];
    return {
      bookmarkFolders: state.bookmarkFolders.filter((group) => group.id !== id),
      bookmarks: state.bookmarks.filter((site) => site.fields.folder_id !== id),
      expandedBookmarkFolders: expanded,
      selectedBookmarkByFolder: selected,
    };
  });
}

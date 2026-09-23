import {
  allLayoutViews,
  parseBrowserTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import { resolveDirectAddress } from "./address";
import type { SharedRecord } from "./model";

function title(value: string): string {
  const result = value.trim();
  if (!result || result.length > 160) throw new Error("Use a name between 1 and 160 characters.");
  return result;
}
export function websiteAddress(input: string): string {
  const direct = resolveDirectAddress(input.trim());
  if (!direct) throw new Error("Enter a website address, such as example.com.");
  const url = new URL(direct);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use an http or https website address.");
  if (url.username || url.password)
    throw new Error("Save the website address without a username or password.");
  return url.href;
}
export function createWebsiteGroup(label: string): string {
  const state = useWorkspaceStore.getState();
  const id = `group:${crypto.randomUUID()}`;
  const group: SharedRecord<"group"> = {
    kind: "group",
    id,
    fields: {
      label: title(label),
      icon: "globe",
      order: Math.max(-1, ...state.websiteGroups.map((item) => item.fields.order)) + 1,
      hidden: false,
    },
  };
  useWorkspaceStore.setState({
    websiteGroups: [...state.websiteGroups, group],
    expandedWebsiteGroups: { ...state.expandedWebsiteGroups, [id]: true },
  });
  return id;
}
export function renameWebsiteGroup(id: string, label: string): void {
  const name = title(label);
  useWorkspaceStore.setState((state) => ({
    websiteGroups: state.websiteGroups.map((group) =>
      group.id === id ? { ...group, fields: { ...group.fields, label: name } } : group,
    ),
  }));
}
export function reorderWebsiteGroups(ids: string[]): void {
  const { websiteGroups } = useWorkspaceStore.getState();
  if (
    ids.length !== websiteGroups.length ||
    new Set(ids).size !== ids.length ||
    websiteGroups.some((group) => !ids.includes(group.id))
  )
    throw new Error("The website groups changed. Try reordering again.");
  useWorkspaceStore.setState({
    websiteGroups: ids.map((id, order) => {
      const group = websiteGroups.find((group) => group.id === id)!;
      return { ...group, fields: { ...group.fields, order } };
    }),
  });
}
export function addWebsite(groupId: string, label: string, address: string): string {
  const state = useWorkspaceStore.getState();
  if (!state.websiteGroups.some((group) => group.id === groupId))
    throw new Error("Choose an existing group.");
  const url = websiteAddress(address);
  const id = `website:${crypto.randomUUID()}`;
  const website: SharedRecord<"website"> = {
    kind: "website",
    id,
    fields: {
      group_id: groupId,
      title: title(label || new URL(url).hostname),
      url,
      pinned: true,
      order:
        Math.max(
          -1,
          ...state.savedWebsites
            .filter((website) => website.fields.group_id === groupId)
            .map((website) => website.fields.order),
        ) + 1,
    },
  };
  useWorkspaceStore.setState({
    savedWebsites: [...state.savedWebsites, website],
    selectedWebsiteByGroup: { ...state.selectedWebsiteByGroup, [groupId]: id },
    expandedWebsiteGroups: { ...state.expandedWebsiteGroups, [groupId]: true },
  });
  return id;
}
export function pinWebsite(id: string, pinned: boolean): void {
  useWorkspaceStore.setState((state) => ({
    savedWebsites: state.savedWebsites.map((website) =>
      website.id === id ? { ...website, fields: { ...website.fields, pinned } } : website,
    ),
  }));
}
export function removeWebsite(id: string): void {
  useWorkspaceStore.setState((state) => ({
    savedWebsites: state.savedWebsites.filter((website) => website.id !== id),
  }));
}
export function expandWebsiteGroup(id: string, open: boolean): void {
  useWorkspaceStore.setState((state) => ({
    expandedWebsiteGroups: { ...state.expandedWebsiteGroups, [id]: open },
  }));
}
/** Saved launch addresses never follow a tab's later page navigation. An ordinary
 * click resumes an existing view in this window; explicit new-tab opens duplicate. */
export function openSavedWebsite(id: string, newTab = false): WorkspaceTab {
  const state = useWorkspaceStore.getState();
  const website = state.savedWebsites.find((website) => website.id === id);
  if (!website) throw new Error("This saved website is no longer available.");
  state.setScope("global");
  const current = useWorkspaceStore.getState();
  const existing =
    !newTab &&
    allLayoutViews(current.layout).find(
      (tab) => tab.surfaceId === "browser" && parseBrowserTabState(tab.state).websiteId === id,
    );
  let opened: WorkspaceTab;
  if (existing) {
    current.focusTab(existing.id);
    opened = existing;
  } else {
    opened = current.openBrowserTab({ url: website.fields.url, websiteId: id });
  }
  useWorkspaceStore.setState((next) => ({
    selectedWebsiteByGroup: { ...next.selectedWebsiteByGroup, [website.fields.group_id]: id },
    expandedWebsiteGroups: { ...next.expandedWebsiteGroups, [website.fields.group_id]: true },
  }));
  return opened;
}

/** Apply a reviewed group draft in one state update, including its contents. */
export function saveWebsiteGroup(
  groupId: string | undefined,
  label: string,
  icon: string,
  sites: { title: string; url: string }[],
): string {
  const name = title(label);
  const normalized = sites.map((site) => ({
    title: title(site.title),
    url: websiteAddress(site.url),
  }));
  const state = useWorkspaceStore.getState();
  const existing = state.websiteGroups.find((group) => group.id === groupId);
  if (groupId && !existing) throw new Error("This group was removed. Choose another group.");
  const id = existing?.id ?? `group:${crypto.randomUUID()}`;
  const urls = new Set<string>();
  const contents = normalized
    .filter((site) => {
      if (urls.has(site.url)) return false;
      urls.add(site.url);
      return true;
    })
    .map((site, order): SharedRecord<"website"> => {
      const saved = state.savedWebsites.find(
        (item) => item.fields.group_id === id && item.fields.url === site.url,
      );
      return {
        kind: "website",
        id: saved?.id ?? `website:${crypto.randomUUID()}`,
        fields: { group_id: id, title: site.title, url: site.url, pinned: true, order },
      };
    });
  const group: SharedRecord<"group"> = {
    kind: "group",
    id,
    fields: {
      label: name,
      icon,
      hidden: false,
      order:
        existing?.fields.order ??
        Math.max(-1, ...state.websiteGroups.map((item) => item.fields.order)) + 1,
    },
  };
  const selection = { ...state.selectedWebsiteByGroup };
  if (!contents.some((site) => site.id === selection[id])) {
    delete selection[id];
    if (contents[0]) selection[id] = contents[0].id;
  }
  useWorkspaceStore.setState({
    websiteGroups: existing
      ? state.websiteGroups.map((item) => (item.id === id ? group : item))
      : [...state.websiteGroups, group],
    savedWebsites: [
      ...state.savedWebsites.filter((site) => site.fields.group_id !== id),
      ...contents,
    ],
    selectedWebsiteByGroup: selection,
    expandedWebsiteGroups: { ...state.expandedWebsiteGroups, [id]: true },
  });
  return id;
}
export function removeWebsiteGroup(id: string): void {
  useWorkspaceStore.setState((state) => {
    const expanded = { ...state.expandedWebsiteGroups };
    const selected = { ...state.selectedWebsiteByGroup };
    delete expanded[id];
    delete selected[id];
    return {
      websiteGroups: state.websiteGroups.filter((group) => group.id !== id),
      savedWebsites: state.savedWebsites.filter((site) => site.fields.group_id !== id),
      expandedWebsiteGroups: expanded,
      selectedWebsiteByGroup: selected,
    };
  });
}

import { mapLayoutViews } from "./layoutTabs";
import {
  browserViewTitle,
  createBrowserViewState,
  parseBrowserViewState,
  type WorkspaceLayout,
  type WorkspaceScopeKey,
  type WorkspaceView,
} from "./model";
/** Saved views synced from records without a route; restore them at their tool's root. */
const missingRouteFallback: Partial<Record<string, string>> = {
  space: "/spaces",
  files: "/files",
  agents: "/agents",
  scheduled: "/scheduled",
  extensions: "/extensions",
};
/** A saved view restore could not carry forward. Its original stays in the
 * archived copy of the saved workspace. */
export interface UnrestoredView {
  id: string;
  title: string;
  reason: string;
}
let unrestored: UnrestoredView[] | undefined;
/** Runs a restore and lists the views it had to replace with placeholders. */
export function collectUnrestoredViews<T>(restore: () => T): {
  result: T;
  skipped: UnrestoredView[];
} {
  const previous = unrestored;
  unrestored = [];
  try {
    const result = restore();
    return { result, skipped: unrestored };
  } finally {
    unrestored = previous;
  }
}

/** Never throws: one damaged view becomes an empty placeholder in its place
 * instead of stopping the rest of the workspace from restoring. */
export function migrateRetiredWorkspaceView(
  view: WorkspaceView,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceView {
  try {
    return migrateView(view, scopeKey);
  } catch (error) {
    const id = typeof view?.id === "string" && view.id ? view.id : crypto.randomUUID();
    const title = typeof view?.title === "string" ? view.title : "";
    unrestored?.push({ id, title, reason: error instanceof Error ? error.message : String(error) });
    return {
      id,
      instanceKey: id,
      surfaceId: "browser",
      groupKey: "tool:browser",
      title,
      route: "/browser",
      sidebarVisible: false,
      state: createBrowserViewState(),
      placeholder: true,
      createdAt: typeof view?.createdAt === "number" ? view.createdAt : 0,
      lastFocusedAt: typeof view?.lastFocusedAt === "number" ? view.lastFocusedAt : 0,
    };
  }
}
function migrateView(view: WorkspaceView, _scopeKey: WorkspaceScopeKey): WorkspaceView {
  const tab =
    typeof view.route === "string"
      ? view
      : { ...view, route: missingRouteFallback[view.surfaceId] ?? "/browser" };
  const route = new URL(tab.route, "https://misty.local");
  if (tab.surfaceId === "scheduled") {
    const params = route.searchParams;
    params.set("view", "scheduled");
    return {
      ...tab,
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: `/agents?${params}`,
    };
  }
  if (tab.surfaceId === "extensions" && /^\/extensions(?:\/|$)/.test(route.pathname)) return tab;
  if (tab.surfaceId === "space" && /^\/spaces(?:\/|$)/.test(tab.route)) return tab;
  const retiredTransfers =
    (tab.surfaceId as string) === "transfers" || (tab.groupKey as string) === "tool:transfers";
  if (tab.surfaceId === "files" || tab.groupKey === "app:files" || retiredTransfers) {
    const url = new URL(tab.route, "https://misty.local");
    const transfers = retiredTransfers || url.searchParams.get("view") === "transfers";
    if (transfers) url.searchParams.set("view", "transfers");
    const search = url.search;
    return {
      ...tab,
      surfaceId: "files",
      title: transfers ? "Transfers" : tab.title,
      state: transfers
        ? {
            ...(tab.state && typeof tab.state === "object" ? tab.state : {}),
            version: 1,
            path: "misty-transfers://history",
          }
        : tab.state,
      groupKey: "tool:files",
      route: `/files${search}`,
      placeholder: tab.placeholder,
    };
  }
  const agents = tab.surfaceId === "agents" || tab.groupKey === "app:agents";
  if (agents) {
    // Legacy Scheduled routes keep their section inside Agents.
    if (route.pathname === "/scheduled") route.searchParams.set("view", "scheduled");
    return {
      ...tab,
      surfaceId: "agents",
      groupKey: "tool:agents",
      route: `/agents${route.search}`,
      placeholder: tab.placeholder,
    };
  }
  const wasBrowser = tab.surfaceId === "browser" || tab.groupKey === "app:browser";
  const state = wasBrowser ? parseBrowserViewState(tab.state) : createBrowserViewState();
  return {
    ...tab,
    surfaceId: "browser",
    groupKey: "tool:browser",
    route: "/browser",
    instanceKey: tab.instanceKey || tab.id,
    state,
    placeholder: tab.placeholder,
    title: wasBrowser && tab.title ? tab.title : browserViewTitle(state.url),
  };
}
export function migrateRetiredWorkspaceViews(
  layout: WorkspaceLayout,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceLayout {
  return mapLayoutViews(layout, (tab) => migrateRetiredWorkspaceView(tab, scopeKey));
}

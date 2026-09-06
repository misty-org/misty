import {
  type WorkspaceGroupKey,
  type WorkspaceScopeKey,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "./model";

const workspaceDefaultTabPreferenceKey = "misty:workspace-default-tab:v1";

export const workspaceDefaultTabOptions = ["Home", "Discover"] as const;

interface DefaultTabDescriptor {
  surfaceId: WorkspaceSurfaceId;
  title: string;
  route: string;
  state?: unknown;
}

let configuredDefaultTabIndex = readStoredDefaultTabIndex();

export function configureWorkspaceDefaultTab(index: number): void {
  configuredDefaultTabIndex = normalizeDefaultTabIndex(index);
  try {
    window.localStorage.setItem(
      workspaceDefaultTabPreferenceKey,
      String(configuredDefaultTabIndex),
    );
  } catch {
    // Storage can be unavailable in private mode. The in-memory preference
    // still applies to panels and windows created during this session.
  }
}

export function workspaceDefaultTabIndex(): number {
  return configuredDefaultTabIndex;
}

export function createDefaultWorkspaceTab(scopeKey: WorkspaceScopeKey): WorkspaceTab {
  const descriptor = defaultTabDescriptor(scopeKey, configuredDefaultTabIndex);
  const now = Date.now();
  const id = `tab:${now.toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    surfaceId: descriptor.surfaceId,
    groupKey: defaultGroupKey(descriptor.surfaceId, scopeKey),
    instanceKey: descriptor.surfaceId === "space" ? scopeKey.slice("space:".length) : id,
    title: descriptor.title,
    route: descriptor.route,
    sidebarVisible: true,
    state: descriptor.state ?? {},
    createdAt: now,
    lastFocusedAt: now,
  };
}

export function createHomeWorkspaceTab(scopeKey: WorkspaceScopeKey): WorkspaceTab {
  const isSpace = scopeKey.startsWith("space:");
  const spaceId = isSpace ? scopeKey.slice("space:".length) : "";
  const now = Date.now();
  const id = `tab:${now.toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
  const surfaceId: WorkspaceSurfaceId = isSpace ? "space" : "home";
  return {
    id,
    surfaceId,
    groupKey: defaultGroupKey(surfaceId, scopeKey),
    instanceKey: isSpace ? spaceId : id,
    title: "Home",
    route: isSpace ? `/spaces/${encodeURIComponent(spaceId)}/home` : "/home",
    sidebarVisible: true,
    state: {},
    createdAt: now,
    lastFocusedAt: now,
  };
}

function defaultTabDescriptor(scopeKey: WorkspaceScopeKey, index: number): DefaultTabDescriptor {
  const choice = workspaceDefaultTabOptions[normalizeDefaultTabIndex(index)];
  if (choice === "Home") {
    if (scopeKey.startsWith("space:")) {
      const spaceId = scopeKey.slice("space:".length);
      return {
        surfaceId: "space",
        title: "Home",
        route: `/spaces/${encodeURIComponent(spaceId)}/home`,
      };
    }
    return { surfaceId: "home", title: "Home", route: "/home" };
  }
  return { surfaceId: "marketplace", title: "Discover", route: "/discover" };
}

function defaultGroupKey(
  surfaceId: WorkspaceSurfaceId,
  scopeKey: WorkspaceScopeKey,
): WorkspaceGroupKey {
  return surfaceId === "space"
    ? (scopeKey as WorkspaceGroupKey)
    : (`tool:${surfaceId}` as WorkspaceGroupKey);
}

function readStoredDefaultTabIndex(): number {
  try {
    return normalizeDefaultTabIndex(
      Number(window.localStorage.getItem(workspaceDefaultTabPreferenceKey)),
    );
  } catch {
    return 0;
  }
}

function normalizeDefaultTabIndex(index: number): number {
  return Number.isInteger(index) && index >= 0 && index < workspaceDefaultTabOptions.length
    ? index
    : 0;
}

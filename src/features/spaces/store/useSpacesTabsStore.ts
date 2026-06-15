import { create } from "zustand";
import { persist } from "zustand/middleware";

const maximumOpenTabs = 16;
const maximumTabTitleLength = 60;
const pendingSpaceId = "__pending__";

export type WorkspaceTabKind =
  "space" | "file-manager" | "agents" | "developer" | "marketplace" | "transfers";

interface WorkspaceTabBase {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
}

export interface SpaceWorkspaceTab extends WorkspaceTabBase {
  kind: "space";
  route: string;
}

export interface FileManagerWorkspaceTab extends WorkspaceTabBase {
  kind: "file-manager";
  workspaceId: string;
}

export interface MarketplaceWorkspaceTab extends WorkspaceTabBase {
  kind: "marketplace";
}

export interface AgentsWorkspaceTab extends WorkspaceTabBase {
  kind: "agents";
}

export interface TransfersWorkspaceTab extends WorkspaceTabBase {
  kind: "transfers";
}

export interface DeveloperWorkspaceTab extends WorkspaceTabBase {
  kind: "developer";
}

export type SpacesTab =
  | SpaceWorkspaceTab
  | FileManagerWorkspaceTab
  | AgentsWorkspaceTab
  | DeveloperWorkspaceTab
  | MarketplaceWorkspaceTab
  | TransfersWorkspaceTab;

export interface SpacesTabsSession {
  tabs: SpacesTab[];
  activeTabId: string;
  nextTabIndex: number;
}

interface SpacesTabsStore {
  sessions: Record<string, SpacesTabsSession>;
  ensureSession: (accountId: string, spaceId: string, initialRoute?: string) => void;
  addTab: (
    accountId: string,
    spaceId: string,
    kind: WorkspaceTabKind,
    initialRoute?: string,
  ) => string | null;
  closeTab: (accountId: string, spaceId: string, tabId: string) => SpacesTab | null;
  reorderTabs: (
    accountId: string,
    spaceId: string,
    tabId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  selectTab: (accountId: string, spaceId: string, tabId: string) => void;
  /** Returns the stored title, or "" when the rename was rejected. */
  renameTab: (accountId: string, spaceId: string, tabId: string, title: string) => string;
  updateActiveSpaceRoute: (accountId: string, spaceId: string, route: string) => void;
  removeSession: (accountId: string, spaceId: string) => SpacesTab[];
  pruneSessions: (accountId: string, validSpaceIds: string[]) => SpacesTab[];
}

export const useSpacesTabsStore = create<SpacesTabsStore>()(
  persist(
    (set, get) => ({
      sessions: {},

      ensureSession: (accountId, spaceId, initialRoute) => {
        if (!accountId || !spaceId) return;
        const key = spacesTabsSessionKey(accountId, spaceId);
        if (get().sessions[key]?.tabs.length) return;

        const pendingKey = spacesTabsSessionKey(accountId, pendingSpaceId);
        const pending = get().sessions[pendingKey];
        const session = pending?.tabs.length
          ? normalizeSession(pending, spaceId)
          : createSession(spaceId, initialRoute);
        set((state) => {
          const sessions = { ...state.sessions, [key]: session };
          delete sessions[pendingKey];
          return { sessions };
        });
      },

      addTab: (accountId, spaceId, kind, initialRoute) => {
        if (!accountId || !spaceId) return null;
        const key = spacesTabsSessionKey(accountId, spaceId);
        const current = get().sessions[key] ?? createSession(spaceId, initialRoute);
        if (current.tabs.length >= maximumOpenTabs) return null;
        const tab = createTab(kind, spaceId, current.nextTabIndex, initialRoute);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              tabs: [...current.tabs, tab],
              activeTabId: tab.id,
              nextTabIndex: current.nextTabIndex + 1,
            },
          },
        }));
        return tab.id;
      },

      closeTab: (accountId, spaceId, tabId) => {
        const key = spacesTabsSessionKey(accountId, spaceId);
        const current = get().sessions[key];
        if (!current) return null;
        const closedIndex = current.tabs.findIndex((tab) => tab.id === tabId);
        if (closedIndex < 0) return null;
        const closed = current.tabs[closedIndex];

        if (current.tabs.length === 1) {
          const fallback = createTab("space", spaceId, current.nextTabIndex);
          set((state) => ({
            sessions: {
              ...state.sessions,
              [key]: {
                tabs: [fallback],
                activeTabId: fallback.id,
                nextTabIndex: current.nextTabIndex + 1,
              },
            },
          }));
          return closed;
        }

        const tabs = current.tabs.filter((tab) => tab.id !== tabId);
        const activeTab =
          current.activeTabId === tabId
            ? (tabs[Math.max(0, closedIndex - 1)] ?? tabs[0])
            : (tabs.find((tab) => tab.id === current.activeTabId) ?? tabs[0]);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [key]: { ...current, tabs, activeTabId: activeTab.id },
          },
        }));
        return closed;
      },

      reorderTabs: (accountId, spaceId, tabId, fromIndex, toIndex) => {
        const key = spacesTabsSessionKey(accountId, spaceId);
        const current = get().sessions[key];
        if (!current || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
        const sourceIndex = current.tabs.findIndex((tab) => tab.id === tabId);
        if (sourceIndex < 0) return;
        const boundedIndex = Math.min(Math.max(toIndex, 0), current.tabs.length - 1);
        const tabs = current.tabs.filter((tab) => tab.id !== tabId);
        tabs.splice(boundedIndex, 0, current.tabs[sourceIndex]);
        set((state) => ({
          sessions: { ...state.sessions, [key]: { ...current, tabs } },
        }));
      },

      selectTab: (accountId, spaceId, tabId) => {
        const key = spacesTabsSessionKey(accountId, spaceId);
        const current = get().sessions[key];
        if (!current || current.activeTabId === tabId) return;
        if (!current.tabs.some((tab) => tab.id === tabId)) return;
        set((state) => ({
          sessions: {
            ...state.sessions,
            [key]: { ...current, activeTabId: tabId },
          },
        }));
      },

      updateActiveSpaceRoute: (accountId, spaceId, route) => {
        const key = spacesTabsSessionKey(accountId, spaceId);
        const current = get().sessions[key];
        if (!current) return;
        const normalizedRoute = normalizeSpacesTabRoute(route, spaceId);
        let changed = false;
        const tabs = current.tabs.map((tab) => {
          if (
            tab.id !== current.activeTabId ||
            tab.kind !== "space" ||
            tab.route === normalizedRoute
          )
            return tab;
          changed = true;
          return { ...tab, route: normalizedRoute };
        });
        if (!changed) return;
        set((state) => ({
          sessions: { ...state.sessions, [key]: { ...current, tabs } },
        }));
      },

      renameTab: (accountId, spaceId, tabId, title) => {
        const trimmed = title.trim().slice(0, maximumTabTitleLength);
        if (!trimmed) return "";
        const key = spacesTabsSessionKey(accountId, spaceId);
        const current = get().sessions[key];
        const target = current?.tabs.find((tab) => tab.id === tabId);
        // Space tabs read their title from the route, so renaming one would be
        // overwritten by the next navigation.
        if (!current || !target || target.kind === "space" || target.title === trimmed) return "";
        set((state) => ({
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              tabs: current.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, title: trimmed } : tab,
              ),
            },
          },
        }));
        return trimmed;
      },

      removeSession: (accountId, spaceId) => {
        const key = spacesTabsSessionKey(accountId, spaceId);
        const tabs = get().sessions[key]?.tabs ?? [];
        set((state) => {
          const sessions = { ...state.sessions };
          delete sessions[key];
          return { sessions };
        });
        return tabs;
      },

      pruneSessions: (accountId, validSpaceIds) => {
        if (!accountId) return [];
        const valid = new Set(validSpaceIds);
        const prefix = `${accountId}::`;
        const removed: SpacesTab[] = [];
        set((state) => {
          const sessions = { ...state.sessions };
          for (const [key, session] of Object.entries(sessions)) {
            if (!key.startsWith(prefix)) continue;
            const spaceId = key.slice(prefix.length);
            if (spaceId === pendingSpaceId || valid.has(spaceId)) continue;
            removed.push(...session.tabs);
            delete sessions[key];
          }
          return { sessions };
        });
        return removed;
      },
    }),
    {
      name: "misty:spaces-tabs",
      version: 3,
      partialize: (state) => ({ sessions: state.sessions }),
      migrate: (persistedState, version) => migratePersistedTabs(persistedState, version),
      merge: (persistedState, currentState) => ({
        ...currentState,
        sessions: sanitizeSessions(
          (persistedState as Partial<SpacesTabsStore> | undefined)?.sessions,
        ),
      }),
    },
  ),
);

export function spacesTabsSessionKey(accountId: string, spaceId: string): string {
  return `${accountId}::${spaceId}`;
}

export function activeSpacesTab(session: SpacesTabsSession | undefined): SpacesTab | null {
  return session?.tabs.find((tab) => tab.id === session.activeTabId) ?? session?.tabs[0] ?? null;
}

export function defaultSpaceRoute(spaceId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/home`;
}

export function normalizeSpacesTabRoute(route: string, spaceId?: string): string {
  const fallback = spaceId ? defaultSpaceRoute(spaceId) : "/spaces";
  const trimmed = route.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed, "https://misty.local");
    if (parsed.pathname !== "/spaces" && !parsed.pathname.startsWith("/spaces/")) return fallback;
    const pathParts = parsed.pathname.split("/");
    if (spaceId && pathParts[2] && decodeURIComponent(pathParts[2]) !== spaceId) return fallback;
    if (pathParts[1] === "spaces" && pathParts[2] && !pathParts[3]) {
      pathParts[3] = "home";
    }
    if (pathParts[1] === "spaces" && pathParts[3] === "tasks") pathParts[3] = "planner";
    if (pathParts[1] === "spaces" && pathParts[3] === "planner") {
      if (!pathParts[4]) pathParts.push("tasks", "board");
      else if (pathParts[4] === "board" || pathParts[4] === "list")
        pathParts.splice(4, 1, "tasks", pathParts[4]);
      else if (pathParts[4] === "calendar") pathParts.splice(4, 1, "agenda", "month");
    }
    return `${pathParts.join("/")}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function createSession(spaceId: string, initialRoute?: string): SpacesTabsSession {
  const tab = createTab("space", spaceId, 0, initialRoute);
  return { tabs: [tab], activeTabId: tab.id, nextTabIndex: 1 };
}

function createTab(
  kind: WorkspaceTabKind,
  spaceId: string,
  index: number,
  initialRoute?: string,
): SpacesTab {
  const id = `space-workspace-tab-${index}`;
  if (kind === "space") {
    return {
      id,
      kind,
      title: "Space",
      route: normalizeSpacesTabRoute(initialRoute ?? defaultSpaceRoute(spaceId), spaceId),
    };
  }
  if (kind === "file-manager") {
    return {
      id,
      kind,
      title: "File Manager",
      workspaceId: `space-files-${encodeURIComponent(spaceId)}-${index}`,
    };
  }
  return { id, kind, title: workspaceToolTitle(kind) };
}

function normalizeSession(session: SpacesTabsSession, spaceId: string): SpacesTabsSession {
  const tabs = session.tabs
    .filter((tab) => tab.kind === "space")
    .map((tab, index) => sanitizeTab(tab, spaceId, index));
  if (!tabs.length) return createSession(spaceId);
  return {
    tabs,
    activeTabId: tabs.some((tab) => tab.id === session.activeTabId)
      ? session.activeTabId
      : (tabs[0]?.id ?? ""),
    nextTabIndex: Math.max(session.nextTabIndex || 0, tabs.length),
  };
}

function sanitizeSessions(value: unknown): Record<string, SpacesTabsSession> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, SpacesTabsSession> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const [accountId, spaceId = pendingSpaceId] = key.split("::");
    if (!accountId) continue;
    const candidate = raw as Partial<SpacesTabsSession>;
    const sourceTabs = Array.isArray(candidate.tabs) ? candidate.tabs : [];
    const tabs = sourceTabs
      .slice(0, maximumOpenTabs)
      .filter((tab) => isPersistedSpaceTab(tab))
      .map((tab, index) => sanitizeTab(tab, spaceId, index));
    if (tabs.length === 0) {
      result[key] = createSession(spaceId);
      continue;
    }
    result[key] = {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === candidate.activeTabId)
        ? String(candidate.activeTabId)
        : tabs[0].id,
      nextTabIndex: Math.max(Number(candidate.nextTabIndex) || 0, tabs.length),
    };
  }
  return result;
}

function isPersistedSpaceTab(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "kind" in value && value.kind === "space");
}

function sanitizeTab(value: unknown, spaceId: string, index: number): SpacesTab {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<SpacesTab> & {
    route?: string;
  };
  const id =
    typeof candidate.id === "string" && candidate.id
      ? candidate.id
      : `space-workspace-tab-${index}`;
  const kind: WorkspaceTabKind = [
    "space",
    "file-manager",
    "agents",
    "developer",
    "marketplace",
    "transfers",
  ].includes(String(candidate.kind))
    ? (candidate.kind as WorkspaceTabKind)
    : "space";
  if (kind === "space")
    return {
      id,
      kind,
      title: "Space",
      route: normalizeSpacesTabRoute(candidate.route ?? defaultSpaceRoute(spaceId), spaceId),
    };
  if (kind === "file-manager")
    return {
      id,
      kind,
      title: "File Manager",
      workspaceId:
        "workspaceId" in candidate && typeof candidate.workspaceId === "string"
          ? candidate.workspaceId
          : `space-files-${encodeURIComponent(spaceId)}-${index}`,
    };
  return { id, kind, title: workspaceToolTitle(kind) };
}

function workspaceToolTitle(kind: Exclude<WorkspaceTabKind, "space" | "file-manager">): string {
  if (kind === "agents") return "Agents";
  if (kind === "developer") return "Code";
  return kind === "marketplace" ? "Discover" : "Transfers";
}

function migratePersistedTabs(
  value: unknown,
  version: number,
): { sessions: Record<string, SpacesTabsSession> } {
  if (version >= 2) {
    const current = value as { sessions?: Record<string, SpacesTabsSession> } | undefined;
    return { sessions: current?.sessions ?? {} };
  }
  const legacy = value as { sessions?: Record<string, SpacesTabsSession> } | undefined;
  const sessions: Record<string, SpacesTabsSession> = {};
  for (const [accountId, session] of Object.entries(legacy?.sessions ?? {})) {
    const groups = new Map<string, SpacesTab[]>();
    for (const [index, legacyTab] of (session.tabs ?? []).entries()) {
      const route = "route" in legacyTab ? String(legacyTab.route) : "/spaces";
      const spaceId = spaceIdFromRoute(route) || pendingSpaceId;
      const group = groups.get(spaceId) ?? [];
      group.push(sanitizeTab({ ...legacyTab, kind: "space" }, spaceId, index));
      groups.set(spaceId, group);
    }
    for (const [spaceId, tabs] of groups) {
      const active = tabs.find((tab) => tab.id === session.activeTabId) ?? tabs[0];
      sessions[spacesTabsSessionKey(accountId, spaceId)] = {
        tabs,
        activeTabId: active.id,
        nextTabIndex: Math.max(session.nextTabIndex || 0, tabs.length),
      };
    }
  }
  return { sessions };
}

function spaceIdFromRoute(route: string): string {
  try {
    const parsed = new URL(route, "https://misty.local");
    const segment = parsed.pathname.split("/").filter(Boolean)[1];
    return segment ? decodeURIComponent(segment) : "";
  } catch {
    return "";
  }
}

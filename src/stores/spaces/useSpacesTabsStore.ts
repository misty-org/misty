import { create } from "zustand";
import { persist } from "zustand/middleware";

const blankSpacesRoute = "/spaces";
const maximumOpenTabs = 16;

export interface SpacesTab {
  id: string;
  route: string;
}

export interface SpacesTabsSession {
  tabs: SpacesTab[];
  activeTabId: string;
  nextTabIndex: number;
}

interface SpacesTabsStore {
  sessions: Record<string, SpacesTabsSession>;
  ensureSession: (accountId: string, initialRoute?: string) => void;
  addBlankTab: (accountId: string) => string;
  closeTab: (accountId: string, tabId: string) => void;
  reorderTabs: (accountId: string, tabId: string, fromIndex: number, toIndex: number) => void;
  selectTab: (accountId: string, tabId: string) => void;
  updateActiveTabRoute: (accountId: string, route: string) => void;
}

export const useSpacesTabsStore = create<SpacesTabsStore>()(
  persist(
    (set, get) => ({
      sessions: {},

      ensureSession: (accountId, initialRoute = blankSpacesRoute) => {
        if (!accountId || get().sessions[accountId]?.tabs.length) return;
        const session = createSession(initialRoute);
        set((state) => ({
          sessions: { ...state.sessions, [accountId]: session },
        }));
      },

      addBlankTab: (accountId) => {
        const current = get().sessions[accountId] ?? createSession();
        if (current.tabs.length >= maximumOpenTabs) {
          return current.activeTabId;
        }
        const tab = createTab(current.nextTabIndex, blankSpacesRoute);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [accountId]: {
              ...current,
              tabs: [...current.tabs, tab],
              activeTabId: tab.id,
              nextTabIndex: current.nextTabIndex + 1,
            },
          },
        }));
        return tab.id;
      },

      closeTab: (accountId, tabId) => {
        const current = get().sessions[accountId];
        if (!current) return;
        const closedIndex = current.tabs.findIndex((tab) => tab.id === tabId);
        if (closedIndex < 0) return;

        if (current.tabs.length === 1) {
          const blankTab = createTab(current.nextTabIndex, blankSpacesRoute);
          set((state) => ({
            sessions: {
              ...state.sessions,
              [accountId]: {
                tabs: [blankTab],
                activeTabId: blankTab.id,
                nextTabIndex: current.nextTabIndex + 1,
              },
            },
          }));
          return;
        }

        const tabs = current.tabs.filter((tab) => tab.id !== tabId);
        const activeTab =
          current.activeTabId === tabId
            ? (tabs[Math.max(0, closedIndex - 1)] ?? tabs[0])
            : (tabs.find((tab) => tab.id === current.activeTabId) ?? tabs[0]);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [accountId]: {
              ...current,
              tabs,
              activeTabId: activeTab.id,
            },
          },
        }));
      },

      reorderTabs: (accountId, tabId, fromIndex, toIndex) => {
        const current = get().sessions[accountId];
        if (!current || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
        const sourceIndex = current.tabs.findIndex((tab) => tab.id === tabId);
        if (sourceIndex < 0) return;
        const boundedIndex = Math.min(Math.max(toIndex, 0), current.tabs.length - 1);
        const tabs = current.tabs.filter((tab) => tab.id !== tabId);
        tabs.splice(boundedIndex, 0, current.tabs[sourceIndex]);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [accountId]: { ...current, tabs },
          },
        }));
      },

      selectTab: (accountId, tabId) => {
        const current = get().sessions[accountId];
        if (!current || current.activeTabId === tabId) return;
        if (!current.tabs.some((tab) => tab.id === tabId)) return;
        set((state) => ({
          sessions: {
            ...state.sessions,
            [accountId]: { ...current, activeTabId: tabId },
          },
        }));
      },

      updateActiveTabRoute: (accountId, route) => {
        const current = get().sessions[accountId];
        if (!current) return;
        const normalizedRoute = normalizeSpacesTabRoute(route);
        let changed = false;
        const tabs = current.tabs.map((tab) => {
          if (tab.id !== current.activeTabId || tab.route === normalizedRoute) return tab;
          changed = true;
          return { ...tab, route: normalizedRoute };
        });
        if (!changed) return;
        set((state) => ({
          sessions: {
            ...state.sessions,
            [accountId]: { ...current, tabs },
          },
        }));
      },
    }),
    {
      name: "misty:spaces-tabs",
      version: 1,
      partialize: (state) => ({ sessions: state.sessions }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SpacesTabsStore> | undefined;
        return {
          ...currentState,
          sessions: sanitizeSessions(persisted?.sessions),
        };
      },
    },
  ),
);

export function activeSpacesTab(session: SpacesTabsSession | undefined): SpacesTab | null {
  return (
    session?.tabs.find((tab) => tab.id === session.activeTabId) ?? session?.tabs[0] ?? null
  );
}

export function normalizeSpacesTabRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed) return blankSpacesRoute;
  try {
    const parsed = new URL(trimmed, "https://misty.local");
    if (parsed.pathname !== blankSpacesRoute && !parsed.pathname.startsWith(`${blankSpacesRoute}/`))
      return blankSpacesRoute;
    const pathParts = parsed.pathname.split("/");
    if (pathParts[1] === "spaces" && pathParts[3] === "tasks") {
      pathParts[3] = "planner";
    }
    return `${pathParts.join("/")}${parsed.search}${parsed.hash}`;
  } catch {
    return blankSpacesRoute;
  }
}

function createSession(initialRoute = blankSpacesRoute): SpacesTabsSession {
  const tab = createTab(0, initialRoute);
  return {
    tabs: [tab],
    activeTabId: tab.id,
    nextTabIndex: 1,
  };
}

function createTab(index: number, route: string): SpacesTab {
  return {
    id: `spaces-tab-${index}`,
    route: normalizeSpacesTabRoute(route),
  };
}

function sanitizeSessions(
  value: Record<string, SpacesTabsSession> | undefined,
): Record<string, SpacesTabsSession> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([accountId, session]) => {
      if (!accountId || !session || !Array.isArray(session.tabs)) return [];
      const tabs = session.tabs
        .filter((tab): tab is SpacesTab => Boolean(tab && typeof tab.id === "string"))
        .slice(0, maximumOpenTabs)
        .map((tab) => ({ id: tab.id, route: normalizeSpacesTabRoute(tab.route) }));
      if (tabs.length === 0) return [[accountId, createSession()]];
      const activeTabId = tabs.some((tab) => tab.id === session.activeTabId)
        ? session.activeTabId
        : tabs[0].id;
      const requestedNextTabIndex =
        Number.isInteger(session.nextTabIndex) && session.nextTabIndex > 0
          ? session.nextTabIndex
          : tabs.length;
      const nextTabIndex = Math.max(
        requestedNextTabIndex,
        ...tabs.map((tab) => tabIndexFromId(tab.id) + 1),
      );
      return [[accountId, { tabs, activeTabId, nextTabIndex }]];
    }),
  );
}

function tabIndexFromId(tabId: string): number {
  const match = tabId.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

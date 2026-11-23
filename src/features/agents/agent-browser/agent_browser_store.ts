import { create } from "zustand";

export interface AgentBrowserTab {
  scopeId: string;
  title: string;
  url: string;
  viewId: string;
  loading?: boolean;
  faviconUrl?: string;
}

export type AgentViewStatus = "working" | "waiting" | "done";

export interface AgentBrowserView {
  id: string;
  label: string;
  taskId: string;
  tabs: string[];
  shownScope: string;
  status: AgentViewStatus;
  lastActed: number;
  picture?: string;
}

export interface AgentBrowserChat {
  conversationId: string;
  views: AgentBrowserView[];
  shownView: string;
  expanded: boolean;
  detached?: boolean;
  hidden?: boolean;
}

export const MAX_VIEWS = 4;

interface AgentBrowserState {
  chats: Record<string, AgentBrowserChat>;
  tabs: Record<string, AgentBrowserTab>;
}

const SAVED_KEY = "misty.agent-browser.v1";
const MAX_SAVED_CHARS = 1_500_000;

export function hydrateAgentBrowser(raw: string | null): AgentBrowserState {
  const empty: AgentBrowserState = { chats: {}, tabs: {} };
  if (!raw) return empty;
  try {
    const saved = JSON.parse(raw) as Partial<AgentBrowserState>;
    if (!saved || typeof saved.chats !== "object" || typeof saved.tabs !== "object") return empty;
    const chats: Record<string, AgentBrowserChat> = {};
    for (const [id, chat] of Object.entries(saved.chats ?? {}))
      chats[id] = {
        ...chat,
        expanded: false,
        views: (chat.views ?? []).map((view) => ({ ...view, status: "done" as const })),
      };
    const tabs: Record<string, AgentBrowserTab> = {};
    for (const [id, tab] of Object.entries(saved.tabs ?? {}))
      tabs[id] = { ...tab, viewId: "", loading: false };
    return { chats, tabs };
  } catch {
    return empty;
  }
}

function savedBrowser(): string | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
}

export const useAgentBrowser = create<AgentBrowserState>(() => hydrateAgentBrowser(savedBrowser()));

const SAVE_AFTER_MS = 1_000;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saved: Pick<AgentBrowserState, "chats" | "tabs"> | undefined;
const idle = (work: () => void) =>
  typeof requestIdleCallback === "function"
    ? requestIdleCallback(work, { timeout: 2_000 })
    : setTimeout(work, 0);
useAgentBrowser.subscribe(() => {
  if (typeof sessionStorage === "undefined" || saveTimer) return;
  saveTimer = setTimeout(
    () =>
      idle(() => {
        saveTimer = undefined;
        const current = useAgentBrowser.getState();
        if (saved?.chats === current.chats && saved.tabs === current.tabs) return;
        saved = { chats: current.chats, tabs: current.tabs };
        try {
          const text = JSON.stringify(saved);
          if (text.length <= MAX_SAVED_CHARS) sessionStorage.setItem(SAVED_KEY, text);
        } catch {}
      }),
    SAVE_AFTER_MS,
  );
});

const set = (change: (state: AgentBrowserState) => Partial<AgentBrowserState>) =>
  useAgentBrowser.setState((state) => change(state));

const withView = (
  chat: AgentBrowserChat,
  id: string,
  change: (view: AgentBrowserView) => AgentBrowserView,
) => ({
  ...chat,
  views: chat.views.map((view) => (view.id === id ? change(view) : view)),
});

function withRoom(views: AgentBrowserView[]): AgentBrowserView[] {
  if (views.length < MAX_VIEWS) return views;
  const done = views.findIndex((view, index) => index > 0 && view.status === "done");
  const drop = done > 0 ? done : 1;
  return views.filter((_, index) => index !== drop);
}

export function addBrowserTab(
  conversationId: string,
  view: { id: string; label: string; taskId: string },
  tab: AgentBrowserTab,
) {
  set((state) => {
    const chat = state.chats[conversationId] ?? {
      conversationId,
      views: [],
      shownView: view.id,
      expanded: false,
    };
    const existing =
      chat.views.find((item) => item.id === view.id) ??
      (view.label === "Main" ? chat.views.find((item) => item.label === "Main") : undefined);
    const views = existing
      ? chat.views.map((item) =>
          item === existing
            ? {
                ...item,
                taskId: view.taskId,
                status: "working" as const,
                lastActed: Date.now(),
                tabs: [...item.tabs, tab.scopeId],
                shownScope: tab.scopeId,
              }
            : item,
        )
      : withRoom(chat.views).concat({
          ...view,
          tabs: [tab.scopeId],
          shownScope: tab.scopeId,
          status: "working" as const,
          lastActed: Date.now(),
        });
    return {
      chats: { ...state.chats, [conversationId]: { ...chat, views, hidden: false } },
      tabs: { ...state.tabs, [tab.scopeId]: tab },
    };
  });
}

export function addPersonView(conversationId: string, tab: AgentBrowserTab) {
  const id = `person-${conversationId}`;
  set((state) => ({
    chats: {
      ...state.chats,
      [conversationId]: {
        conversationId,
        views: [
          {
            id,
            label: "Main",
            taskId: "",
            tabs: [tab.scopeId],
            shownScope: tab.scopeId,
            status: "done",
            lastActed: Date.now(),
          },
        ],
        shownView: id,
        expanded: true,
      },
    },
    tabs: { ...state.tabs, [tab.scopeId]: tab },
  }));
}

export function moveBrowserChat(from: string, to: string) {
  set((state) => {
    const chat = state.chats[from];
    if (!chat || state.chats[to]) return state;
    const rename = (id: string) => (id === `person-${from}` ? `person-${to}` : id);
    const chats = { ...state.chats };
    delete chats[from];
    chats[to] = {
      ...chat,
      conversationId: to,
      views: chat.views.map((view) => ({ ...view, id: rename(view.id) })),
      shownView: rename(chat.shownView),
    };
    return { chats };
  });
}

export const isBrowserOpen = (chat: AgentBrowserChat | undefined) =>
  Boolean(chat?.expanded && !chat.hidden && chat.views.length);

export function viewOfTab(
  scopeId: string,
): { chat: AgentBrowserChat; view: AgentBrowserView } | undefined {
  for (const chat of Object.values(useAgentBrowser.getState().chats))
    for (const view of chat.views) if (view.tabs.includes(scopeId)) return { chat, view };
  return undefined;
}

export function browserTabActed(scopeId: string) {
  const found = viewOfTab(scopeId);
  if (!found) return;
  set((state) => ({
    chats: {
      ...state.chats,
      [found.chat.conversationId]: withView(found.chat, found.view.id, (view) => ({
        ...view,
        shownScope: scopeId,
        status: "working",
        lastActed: Date.now(),
      })),
    },
  }));
}

export function updateBrowserTab(scopeId: string, change: Partial<AgentBrowserTab>) {
  set((state) =>
    state.tabs[scopeId]
      ? { tabs: { ...state.tabs, [scopeId]: { ...state.tabs[scopeId]!, ...change } } }
      : {},
  );
}

export function removeBrowserTab(scopeId: string) {
  const found = viewOfTab(scopeId);
  set((state) => {
    const tabs = { ...state.tabs };
    delete tabs[scopeId];
    if (!found) return { tabs };
    const chat = withView(found.chat, found.view.id, (view) => {
      const rest = view.tabs.filter((item) => item !== scopeId);
      return {
        ...view,
        tabs: rest,
        shownScope: view.shownScope === scopeId ? (rest[rest.length - 1] ?? "") : view.shownScope,
      };
    });
    return { tabs, chats: { ...state.chats, [chat.conversationId]: chat } };
  });
}

export function setViewPicture(viewId: string, picture: string) {
  set((state) => {
    const chat = Object.values(state.chats).find((item) =>
      item.views.some((view) => view.id === viewId),
    );
    if (!chat) return {};
    return {
      chats: {
        ...state.chats,
        [chat.conversationId]: withView(chat, viewId, (view) => ({ ...view, picture })),
      },
    };
  });
}

export function finishTaskViews(taskId: string) {
  set((state) => {
    const chats = { ...state.chats };
    for (const [id, chat] of Object.entries(chats))
      if (chat.views.some((view) => view.taskId === taskId))
        chats[id] = {
          ...chat,
          views: chat.views.map((view) =>
            view.taskId === taskId ? { ...view, status: "done" } : view,
          ),
        };
    return { chats };
  });
}

export const showView = (conversationId: string, viewId: string) =>
  set((state) =>
    state.chats[conversationId]
      ? {
          chats: {
            ...state.chats,
            [conversationId]: { ...state.chats[conversationId]!, shownView: viewId },
          },
        }
      : {},
  );

export const showViewTab = (conversationId: string, viewId: string, scopeId: string) =>
  set((state) => {
    const chat = state.chats[conversationId];
    return chat
      ? {
          chats: {
            ...state.chats,
            [conversationId]: withView(chat, viewId, (view) => ({ ...view, shownScope: scopeId })),
          },
        }
      : {};
  });

export const setBrowserExpanded = (conversationId: string, expanded: boolean) =>
  set((state) =>
    state.chats[conversationId]
      ? {
          chats: {
            ...state.chats,
            [conversationId]: {
              ...state.chats[conversationId]!,
              expanded,
              detached: false,
              ...(expanded ? { hidden: false } : {}),
            },
          },
        }
      : {},
  );

export const detachAgentBrowser = (conversationId: string) =>
  set((state) =>
    state.chats[conversationId]
      ? {
          chats: {
            ...state.chats,
            [conversationId]: {
              ...state.chats[conversationId]!,
              expanded: false,
              detached: true,
              hidden: false,
            },
          },
        }
      : {},
  );

export const closeAgentBrowser = (conversationId: string) =>
  set((state) =>
    state.chats[conversationId]
      ? {
          chats: {
            ...state.chats,
            [conversationId]: {
              ...state.chats[conversationId]!,
              expanded: false,
              detached: false,
              hidden: true,
            },
          },
        }
      : {},
  );

export const resetAgentBrowser = () => useAgentBrowser.setState({ chats: {}, tabs: {} });

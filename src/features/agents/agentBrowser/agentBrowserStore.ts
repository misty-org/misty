import { create } from "zustand";

/**
 * The agent browser (docs/agents/browser.md): per chat, the views its agent works in,
 * each with its own tabs. Device-local: not in the sync tree, kept across a renderer reload (session
 * storage) and gone on an app restart. Pages themselves live in agentTabs.ts; this is what the split
 * and the PiP show.
 */
export interface AgentBrowserTab {
  scopeId: string;
  title: string;
  url: string;
  /** Its live page, or "" while the tab sleeps. */
  viewId: string;
  loading?: boolean;
  faviconUrl?: string;
}

export type AgentViewStatus = "working" | "waiting" | "done";

export interface AgentBrowserView {
  /** The main agent's task, or a sub-agent's tab scope. */
  id: string;
  label: string;
  taskId: string;
  /** Its tabs' scopes in the order they opened. */
  tabs: string[];
  /** The tab the agent acted on last, which the view shows. */
  shownScope: string;
  status: AgentViewStatus;
  lastActed: number;
  /** A small picture of the shown tab (data URL), for the switcher and the PiP. */
  picture?: string;
}

export interface AgentBrowserChat {
  conversationId: string;
  views: AgentBrowserView[];
  shownView: string;
  /** The full split, or the PiP at the top of the chat. */
  expanded: boolean;
}

/** A chat shows up to four views; the agent closes one before it starts another. */
export const MAX_VIEWS = 4;

interface AgentBrowserState {
  chats: Record<string, AgentBrowserChat>;
  tabs: Record<string, AgentBrowserTab>;
}

const SAVED_KEY = "misty.agent-browser.v1";
const MAX_SAVED_CHARS = 1_500_000;

/**
 * What a reload brings back: the views and tabs as they were, every tab asleep (its page is gone
 * with the renderer and opens again from its address when shown) and every view done (its run is
 * not driven from this renderer any more). A bad or missing save is an empty browser.
 */
export function hydrateAgentBrowser(raw: string | null): AgentBrowserState {
  const empty: AgentBrowserState = { chats: {}, tabs: {} };
  if (!raw) return empty;
  try {
    const saved = JSON.parse(raw) as Partial<AgentBrowserState>;
    if (!saved || typeof saved.chats !== "object" || typeof saved.tabs !== "object") return empty;
    const chats: Record<string, AgentBrowserChat> = {};
    for (const [id, chat] of Object.entries(saved.chats ?? {}))
      // A reload comes back as the PiP, whatever the chat had open.
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

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useAgentBrowser.subscribe((state) => {
  if (typeof sessionStorage === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const text = JSON.stringify({ chats: state.chats, tabs: state.tabs });
      if (text.length <= MAX_SAVED_CHARS) sessionStorage.setItem(SAVED_KEY, text);
    } catch {
      // Storage may be full or blocked; the browser simply starts empty after the next reload.
    }
  }, 300);
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

/** Room for one more view: a full chat lets go of its oldest finished view, else its oldest
 * sub-agent's, never the main agent's (the first). */
function withRoom(views: AgentBrowserView[]): AgentBrowserView[] {
  if (views.length < MAX_VIEWS) return views;
  const done = views.findIndex((view, index) => index > 0 && view.status === "done");
  const drop = done > 0 ? done : 1;
  return views.filter((_, index) => index !== drop);
}

/** A tab an agent opened in one of a chat's views; the view and chat appear with their first tab. */
export function addBrowserTab(
  conversationId: string,
  view: { id: string; label: string; taskId: string },
  tab: AgentBrowserTab,
) {
  set((state) => {
    // A chat's agent browser starts as the PiP; the person opens the full split by clicking it.
    const chat = state.chats[conversationId] ?? {
      conversationId,
      views: [],
      shownView: view.id,
      expanded: false,
    };
    // The main agent has one view per chat, whichever run opened the tab: a view per run showed a
    // row of identical "Main" cards. A later run takes the view over (its task, working again).
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
      chats: { ...state.chats, [conversationId]: { ...chat, views } },
      tabs: { ...state.tabs, [tab.scopeId]: tab },
    };
  });
}

/** The chat and view a tab belongs to. */
export function viewOfTab(
  scopeId: string,
): { chat: AgentBrowserChat; view: AgentBrowserView } | undefined {
  for (const chat of Object.values(useAgentBrowser.getState().chats))
    for (const view of chat.views) if (view.tabs.includes(scopeId)) return { chat, view };
  return undefined;
}

/** The agent acted on a tab: its view shows that tab and is working. */
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

/** A task's views are done: its run ended. */
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
            [conversationId]: { ...state.chats[conversationId]!, expanded },
          },
        }
      : {},
  );

/** For tests. */
export const resetAgentBrowser = () => useAgentBrowser.setState({ chats: {}, tabs: {} });

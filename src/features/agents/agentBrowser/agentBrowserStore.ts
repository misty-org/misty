import { create } from "zustand";

/**
 * The agent browser (docs/design/agent-browser/BRIEF.md): per chat, the views its agent works in,
 * each with its own tabs. Device-local and in memory only: not in the sync tree, gone on restart.
 * Pages themselves live in agentTabs.ts; this is what the split and the PiP show.
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

export const useAgentBrowser = create<AgentBrowserState>(() => ({ chats: {}, tabs: {} }));

const set = (change: (state: AgentBrowserState) => Partial<AgentBrowserState>) =>
  useAgentBrowser.setState((state) => change(state));

const withView = (chat: AgentBrowserChat, id: string, change: (view: AgentBrowserView) => AgentBrowserView) => ({
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
    const chat = state.chats[conversationId] ?? { conversationId, views: [], shownView: view.id, expanded: true };
    const existing = chat.views.find((item) => item.id === view.id);
    const views = existing
      ? chat.views.map((item) =>
          item.id === view.id ? { ...item, tabs: [...item.tabs, tab.scopeId], shownScope: tab.scopeId } : item,
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
export function viewOfTab(scopeId: string): { chat: AgentBrowserChat; view: AgentBrowserView } | undefined {
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
  set((state) => (state.tabs[scopeId] ? { tabs: { ...state.tabs, [scopeId]: { ...state.tabs[scopeId]!, ...change } } } : {}));
}

export function removeBrowserTab(scopeId: string) {
  const found = viewOfTab(scopeId);
  set((state) => {
    const tabs = { ...state.tabs };
    delete tabs[scopeId];
    if (!found) return { tabs };
    const chat = withView(found.chat, found.view.id, (view) => {
      const rest = view.tabs.filter((item) => item !== scopeId);
      return { ...view, tabs: rest, shownScope: view.shownScope === scopeId ? (rest[rest.length - 1] ?? "") : view.shownScope };
    });
    return { tabs, chats: { ...state.chats, [chat.conversationId]: chat } };
  });
}

export function setViewPicture(viewId: string, picture: string) {
  set((state) => {
    const chat = Object.values(state.chats).find((item) => item.views.some((view) => view.id === viewId));
    if (!chat) return {};
    return { chats: { ...state.chats, [chat.conversationId]: withView(chat, viewId, (view) => ({ ...view, picture })) } };
  });
}

/** A task's views are done: its run ended. */
export function finishTaskViews(taskId: string) {
  set((state) => {
    const chats = { ...state.chats };
    for (const [id, chat] of Object.entries(chats))
      if (chat.views.some((view) => view.taskId === taskId))
        chats[id] = { ...chat, views: chat.views.map((view) => (view.taskId === taskId ? { ...view, status: "done" } : view)) };
    return { chats };
  });
}

export const showView = (conversationId: string, viewId: string) =>
  set((state) => (state.chats[conversationId] ? { chats: { ...state.chats, [conversationId]: { ...state.chats[conversationId]!, shownView: viewId } } } : {}));

export const showViewTab = (conversationId: string, viewId: string, scopeId: string) =>
  set((state) => {
    const chat = state.chats[conversationId];
    return chat ? { chats: { ...state.chats, [conversationId]: withView(chat, viewId, (view) => ({ ...view, shownScope: scopeId })) } } : {};
  });

export const setBrowserExpanded = (conversationId: string, expanded: boolean) =>
  set((state) => (state.chats[conversationId] ? { chats: { ...state.chats, [conversationId]: { ...state.chats[conversationId]!, expanded } } } : {}));

/** For tests. */
export const resetAgentBrowser = () => useAgentBrowser.setState({ chats: {}, tabs: {} });

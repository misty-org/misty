// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { clearTerminalSessionState } from "./sessions";
import { terminalApi } from "./terminalApi";

export interface TerminalTab {
  /** Unique; also the native shell's key. */
  id: string;
  /** The folder the shell runs in: the chat's folder when the tab was opened. */
  folder: string;
  /** A name of its own, such as the launch script's; tabs without one are numbered. */
  title?: string;
}

interface TerminalState {
  /** Tabs per chat (`terminalChatKey`); each tab's shell runs in its own folder. */
  tabsByChat: Record<string, TerminalTab[]>;
  activeByChat: Record<string, string>;
  /** The tab a chat's launch script reuses, by chat, folder and script key. */
  launchTabs: Record<string, string>;
  /** Opens a new tab for a chat, running in `folder`, and makes it the active one. Returns its id. */
  newTab: (chat: string, folder: string, title?: string) => string;
  selectTab: (chat: string, id: string) => void;
  closeTab: (chat: string, id: string) => void;
  renameTab: (chat: string, id: string, title: string) => void;
  /** The chat's tab `key` names in a folder, made when it doesn't exist yet, and selected. */
  ensureTab: (chat: string, folder: string, key: string, title: string) => string;
  /** Hands a chat's tabs to another key: a new chat's, once it has been sent and has an id. */
  moveChat: (from: string, to: string) => void;
  /** Ends every shell a chat has open. */
  closeChat: (chat: string) => void;
}

/**
 * The key a chat's terminals are kept under: its id, or for a new chat not yet sent, the view
 * it is open in, so two new chats side by side don't share terminals.
 */
export function terminalChatKey(conversationId: string, viewId: string | null): string {
  return conversationId || `new:${viewId ?? ""}`;
}

/** Ends the native shell and drops what was kept for it. */
function destroySession(id: string): void {
  clearTerminalSessionState(id);
  void terminalApi.close(id).catch(() => undefined);
}

const newId = () => `terminal-${crypto.randomUUID()}`;

// Shells live as long as their window, so a reloaded window finds its tabs again here.
const STORAGE_KEY = "misty.chatTerminalTabs";

function readSaved(): Pick<TerminalState, "tabsByChat" | "activeByChat" | "launchTabs"> {
  const empty = { tabsByChat: {}, activeByChat: {}, launchTabs: {} };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const saved = JSON.parse(raw) as Partial<typeof empty>;
    return {
      tabsByChat: saved.tabsByChat ?? {},
      activeByChat: saved.activeByChat ?? {},
      launchTabs: saved.launchTabs ?? {},
    };
  } catch {
    return empty;
  }
}

const without = <T>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([other]) => other !== key));

export const useTerminalStore = create<TerminalState>((set, get) => ({
  ...readSaved(),

  newTab: (chat, folder, title) => {
    const id = newId();
    const tab: TerminalTab = title ? { id, folder, title } : { id, folder };
    set((s) => ({
      tabsByChat: { ...s.tabsByChat, [chat]: [...(s.tabsByChat[chat] ?? []), tab] },
      activeByChat: { ...s.activeByChat, [chat]: id },
    }));
    return id;
  },

  selectTab: (chat, id) => set((s) => ({ activeByChat: { ...s.activeByChat, [chat]: id } })),

  closeTab: (chat, id) => {
    destroySession(id);
    set((s) => {
      const tabs = (s.tabsByChat[chat] ?? []).filter((tab) => tab.id !== id);
      const closedIndex = (s.tabsByChat[chat] ?? []).findIndex((tab) => tab.id === id);
      const nextActive =
        s.activeByChat[chat] === id
          ? (tabs[Math.min(closedIndex, tabs.length - 1)]?.id ?? "")
          : s.activeByChat[chat];
      const launchTabs = Object.fromEntries(
        Object.entries(s.launchTabs).filter(([, tab]) => tab !== id),
      );
      return {
        tabsByChat: { ...s.tabsByChat, [chat]: tabs },
        activeByChat: { ...s.activeByChat, [chat]: nextActive },
        launchTabs,
      };
    });
  },

  renameTab: (chat, id, title) =>
    set((s) => ({
      tabsByChat: {
        ...s.tabsByChat,
        [chat]: (s.tabsByChat[chat] ?? []).map((tab) =>
          tab.id === id ? { ...tab, title: title.trim() || undefined } : tab,
        ),
      },
    })),

  ensureTab: (chat, folder, key, title) => {
    const slot = `${chat}\n${folder}\n${key}`;
    const saved = get().launchTabs[slot];
    if (saved && (get().tabsByChat[chat] ?? []).some((tab) => tab.id === saved)) {
      get().selectTab(chat, saved);
      get().renameTab(chat, saved, title);
      return saved;
    }
    const id = get().newTab(chat, folder, title);
    set((s) => ({ launchTabs: { ...s.launchTabs, [slot]: id } }));
    return id;
  },

  moveChat: (from, to) => {
    if (from === to || !get().tabsByChat[from]?.length) return;
    set((s) => ({
      tabsByChat: {
        ...without(s.tabsByChat, from),
        [to]: [...(s.tabsByChat[to] ?? []), ...(s.tabsByChat[from] ?? [])],
      },
      activeByChat: {
        ...without(s.activeByChat, from),
        [to]: s.activeByChat[from] || s.activeByChat[to] || "",
      },
      launchTabs: Object.fromEntries(
        Object.entries(s.launchTabs).map(([slot, id]) => [
          slot.startsWith(`${from}\n`) ? `${to}${slot.slice(from.length)}` : slot,
          id,
        ]),
      ),
    }));
  },

  closeChat: (chat) => {
    const tabs = get().tabsByChat[chat];
    if (!tabs) return;
    tabs.forEach((tab) => destroySession(tab.id));
    set((s) => ({
      tabsByChat: without(s.tabsByChat, chat),
      activeByChat: without(s.activeByChat, chat),
      launchTabs: Object.fromEntries(
        Object.entries(s.launchTabs).filter(([slot]) => !slot.startsWith(`${chat}\n`)),
      ),
    }));
  },
}));

useTerminalStore.subscribe((state) => {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabsByChat: state.tabsByChat,
        activeByChat: state.activeByChat,
        launchTabs: state.launchTabs,
      }),
    );
  } catch {
    // Without storage the tabs still work; they just don't come back after a reload.
  }
});

/** A tab's name in the strip: its own, or its place among the chat's tabs. */
export function terminalTabTitle(tab: Pick<TerminalTab, "title">, index: number): string {
  return tab.title || `Terminal ${index + 1}`;
}

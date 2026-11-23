// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { clearTerminalSessionState } from "./sessions";
import { terminalApi } from "./terminal_api";

export interface TerminalTab {
  id: string;
  folder: string;
  title?: string;
}

interface TerminalState {
  tabsByChat: Record<string, TerminalTab[]>;
  activeByChat: Record<string, string>;
  launchTabs: Record<string, string>;
  newTab: (chat: string, folder: string, title?: string) => string;
  selectTab: (chat: string, id: string) => void;
  closeTab: (chat: string, id: string) => void;
  renameTab: (chat: string, id: string, title: string) => void;
  ensureTab: (chat: string, folder: string, key: string, title: string) => string;
  moveChat: (from: string, to: string) => void;
  closeChat: (chat: string) => void;
}

export function terminalChatKey(conversationId: string, viewId: string | null): string {
  return conversationId || `new:${viewId ?? ""}`;
}

function destroySession(id: string): void {
  clearTerminalSessionState(id);
  void terminalApi.close(id).catch(() => undefined);
}

const newId = () => `terminal-${crypto.randomUUID()}`;

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
  } catch {}
});

export function terminalTabTitle(tab: Pick<TerminalTab, "title">, index: number): string {
  return tab.title || `Terminal ${index + 1}`;
}

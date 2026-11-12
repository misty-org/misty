// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { clearTerminalSessionState } from "./sessions";
import { terminalApi } from "./terminalApi";

export interface TerminalTab {
  /** Unique; also the native shell's key. */
  id: string;
  /** A name of its own, such as the launch script's; tabs without one are numbered. */
  title?: string;
}

interface TerminalState {
  /** Tabs per folder; each folder's shells run in that folder. */
  tabsByFolder: Record<string, TerminalTab[]>;
  activeByFolder: Record<string, string>;
  /** The tab a folder's launch script reuses, by script id. */
  launchTabs: Record<string, string>;
  /** Opens a new tab in a folder and makes it the active one. Returns its id. */
  newTab: (folder: string, title?: string) => string;
  selectTab: (folder: string, id: string) => void;
  closeTab: (folder: string, id: string) => void;
  renameTab: (folder: string, id: string, title: string) => void;
  /** The tab `key` names in a folder, made when it doesn't exist yet, and selected. */
  ensureTab: (folder: string, key: string, title: string) => string;
}

/** Ends the native shell and drops what was kept for it. */
function destroySession(id: string): void {
  clearTerminalSessionState(id);
  void terminalApi.close(id).catch(() => undefined);
}

const newId = () => `terminal-${crypto.randomUUID()}`;

// Shells live as long as their window, so a reloaded window finds its tabs again here.
const STORAGE_KEY = "misty.terminalTabs";

function readSaved(): Pick<TerminalState, "tabsByFolder" | "activeByFolder" | "launchTabs"> {
  const empty = { tabsByFolder: {}, activeByFolder: {}, launchTabs: {} };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const saved = JSON.parse(raw) as Partial<typeof empty>;
    return {
      tabsByFolder: saved.tabsByFolder ?? {},
      activeByFolder: saved.activeByFolder ?? {},
      launchTabs: saved.launchTabs ?? {},
    };
  } catch {
    return empty;
  }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  ...readSaved(),

  newTab: (folder, title) => {
    const id = newId();
    set((s) => ({
      tabsByFolder: {
        ...s.tabsByFolder,
        [folder]: [...(s.tabsByFolder[folder] ?? []), title ? { id, title } : { id }],
      },
      activeByFolder: { ...s.activeByFolder, [folder]: id },
    }));
    return id;
  },

  selectTab: (folder, id) =>
    set((s) => ({ activeByFolder: { ...s.activeByFolder, [folder]: id } })),

  closeTab: (folder, id) => {
    destroySession(id);
    set((s) => {
      const tabs = (s.tabsByFolder[folder] ?? []).filter((tab) => tab.id !== id);
      const closedIndex = (s.tabsByFolder[folder] ?? []).findIndex((tab) => tab.id === id);
      const nextActive =
        s.activeByFolder[folder] === id
          ? (tabs[Math.min(closedIndex, tabs.length - 1)]?.id ?? "")
          : s.activeByFolder[folder];
      const launchTabs = Object.fromEntries(
        Object.entries(s.launchTabs).filter(([, tab]) => tab !== id),
      );
      return {
        tabsByFolder: { ...s.tabsByFolder, [folder]: tabs },
        activeByFolder: { ...s.activeByFolder, [folder]: nextActive },
        launchTabs,
      };
    });
  },

  renameTab: (folder, id, title) =>
    set((s) => ({
      tabsByFolder: {
        ...s.tabsByFolder,
        [folder]: (s.tabsByFolder[folder] ?? []).map((tab) =>
          tab.id === id ? { ...tab, title: title.trim() || undefined } : tab,
        ),
      },
    })),

  ensureTab: (folder, key, title) => {
    const slot = `${folder}\n${key}`;
    const saved = get().launchTabs[slot];
    if (saved && (get().tabsByFolder[folder] ?? []).some((tab) => tab.id === saved)) {
      get().selectTab(folder, saved);
      get().renameTab(folder, saved, title);
      return saved;
    }
    const id = get().newTab(folder, title);
    set((s) => ({ launchTabs: { ...s.launchTabs, [slot]: id } }));
    return id;
  },
}));

useTerminalStore.subscribe((state) => {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabsByFolder: state.tabsByFolder,
        activeByFolder: state.activeByFolder,
        launchTabs: state.launchTabs,
      }),
    );
  } catch {
    // Without storage the tabs still work; they just don't come back after a reload.
  }
});

/** A tab's name in the strip: its own, or its place among the folder's tabs. */
export function terminalTabTitle(tab: TerminalTab, index: number): string {
  return tab.title || `Terminal ${index + 1}`;
}

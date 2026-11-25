import { create } from "zustand";
import { webHomeUrl } from "./web_address";

export interface WebTabFailure {
  url: string;
  offline: boolean;
  message: string;
}

export interface WebTab {
  id: string;
  scopeId: string;
  viewId: string;
  url: string;
  title: string;
  faviconUrl?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  spaceId: string;
  fresh: boolean;
  failure?: WebTabFailure;
}

interface SavedWebTab {
  id: string;
  url: string;
  title: string;
}

const savedKey = "misty.web-tabs";
const keepSaved = 60;

function readSaved(): Record<string, SavedWebTab> {
  try {
    const raw = window.localStorage.getItem(savedKey);
    const parsed = raw ? (JSON.parse(raw) as SavedWebTab[]) : [];
    return Object.fromEntries(
      parsed
        .filter((tab) => typeof tab?.id === "string" && typeof tab.url === "string")
        .map((tab) => [tab.id, { id: tab.id, url: tab.url, title: String(tab.title ?? "") }]),
    );
  } catch {
    return {};
  }
}

const saved = readSaved();

function writeSaved() {
  try {
    const kept = Object.values(saved).slice(-keepSaved);
    window.localStorage.setItem(savedKey, JSON.stringify(kept));
  } catch {
    return;
  }
}

export const useWebTabs = create<{ tabs: Record<string, WebTab> }>(() => ({ tabs: {} }));

export const webTab = (id: string): WebTab | undefined => useWebTabs.getState().tabs[id];

export const webTabOfView = (viewId: string): WebTab | undefined =>
  viewId
    ? Object.values(useWebTabs.getState().tabs).find((tab) => tab.viewId === viewId)
    : undefined;

export function ensureWebTab(id: string, url = ""): WebTab {
  const existing = webTab(id);
  if (existing) return existing;
  const remembered = saved[id];
  const tab: WebTab = {
    id,
    scopeId: `web-scope-${id}`,
    viewId: "",
    url: remembered?.url ?? (url || webHomeUrl),
    title: remembered?.title ?? "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    zoom: 1,
    spaceId: "",
    fresh: !remembered,
  };
  useWebTabs.setState((state) => ({ tabs: { ...state.tabs, [id]: tab } }));
  return tab;
}

export function updateWebTab(id: string, change: Partial<WebTab>) {
  const current = webTab(id);
  if (!current) return;
  const next = { ...current, ...change };
  useWebTabs.setState((state) => ({ tabs: { ...state.tabs, [id]: next } }));
  if (change.url !== undefined || change.title !== undefined) {
    delete saved[id];
    saved[id] = { id, url: next.url, title: next.title };
    writeSaved();
  }
}

export function dropWebTab(id: string) {
  useWebTabs.setState((state) => {
    const tabs = { ...state.tabs };
    delete tabs[id];
    return { tabs };
  });
}

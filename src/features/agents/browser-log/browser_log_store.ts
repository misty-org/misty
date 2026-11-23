import { create } from "zustand";
import { useContextPanel } from "../context-panel/context_panel_store";

export interface OpenBrowserLog {
  runId: string;
  callId?: string;
  openedAt: number;
}

interface BrowserLogState {
  chats: Record<string, OpenBrowserLog | undefined>;
}

export const useBrowserLog = create<BrowserLogState>(() => ({ chats: {} }));

export function openBrowserLog(conversationId: string, runId: string, callId?: string) {
  useContextPanel.getState().close();
  useBrowserLog.setState((state) => ({
    chats: { ...state.chats, [conversationId]: { runId, callId, openedAt: Date.now() } },
  }));
}

export function closeBrowserLog(conversationId: string) {
  useBrowserLog.setState((state) => {
    if (!state.chats[conversationId]) return state;
    const chats = { ...state.chats };
    delete chats[conversationId];
    return { chats };
  });
}

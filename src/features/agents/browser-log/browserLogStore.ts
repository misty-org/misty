import { create } from "zustand";
import { useContextPanel } from "../context-panel/contextPanelStore";

/** The browser log a chat's browser panel shows in place of the page, and where it opened. */
export interface OpenBrowserLog {
  runId: string;
  /** The tool call to show first (`<run>:<call>`), when the log opened from an activity step. */
  callId?: string;
  /** Changes on every open, so opening at the same call again scrolls to it again. */
  openedAt: number;
}

interface BrowserLogState {
  chats: Record<string, OpenBrowserLog | undefined>;
}

export const useBrowserLog = create<BrowserLogState>(() => ({ chats: {} }));

/**
 * Shows a run's browser log in the chat's browser panel, at a tool call's actions when given one.
 * The panel takes the side slot, so an open context view (Steps, say) gives way to it.
 */
export function openBrowserLog(conversationId: string, runId: string, callId?: string) {
  useContextPanel.getState().close();
  useBrowserLog.setState((state) => ({
    chats: { ...state.chats, [conversationId]: { runId, callId, openedAt: Date.now() } },
  }));
}

/** Back to the page, or with no page to go back to, the panel closes. */
export function closeBrowserLog(conversationId: string) {
  useBrowserLog.setState((state) => {
    if (!state.chats[conversationId]) return state;
    const chats = { ...state.chats };
    delete chats[conversationId];
    return { chats };
  });
}

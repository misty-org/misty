import { create } from "zustand";

/** What the chat's side panel shows: a thread, as a docked column beside it, as in Slack. */
interface ChatSidePanelState {
  threadRootId: string;
  openThread(rootId: string): void;
  closeThread(): void;
  reset(): void;
}

export const useChatSidePanel = create<ChatSidePanelState>((set) => ({
  threadRootId: "",
  openThread: (threadRootId) => set({ threadRootId }),
  closeThread: () => set({ threadRootId: "" }),
  reset: () => set({ threadRootId: "" }),
}));

import { create } from "zustand";

/**
 * What the chat's side panels show. A transcript floats over the chat's right edge so the
 * channel stays in view; a thread is a docked column beside it, as in Slack.
 */
interface ChatSidePanelState {
  transcriptRequestId: string;
  threadRootId: string;
  openTranscript(requestId: string): void;
  closeTranscript(): void;
  openThread(rootId: string): void;
  closeThread(): void;
  reset(): void;
}

export const useChatSidePanel = create<ChatSidePanelState>((set) => ({
  transcriptRequestId: "",
  threadRootId: "",
  openTranscript: (transcriptRequestId) => set({ transcriptRequestId }),
  closeTranscript: () => set({ transcriptRequestId: "" }),
  openThread: (threadRootId) => set({ threadRootId }),
  closeThread: () => set({ threadRootId: "" }),
  reset: () => set({ transcriptRequestId: "", threadRootId: "" }),
}));

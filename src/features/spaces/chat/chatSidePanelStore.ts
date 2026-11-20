import { create } from "zustand";
import type { SpaceMessage } from "../api/dto/entities";

/**
 * What the chat's side panel shows, docked to the right of the chat as in Slack: one thread, or the list
 * of the threads the person follows.
 */
interface ChatSidePanelState {
  threadRootId: string;
  /**
   * The thread's root as it was when opened, for a root the chat hasn't loaded (a thread opened from the
   * list, whose message is further back).
   */
  threadRoot: SpaceMessage | undefined;
  threadsListOpen: boolean;
  /** The thread was opened from the list, so its header offers the way back. */
  threadFromList: boolean;
  openThread(rootId: string, root?: SpaceMessage, fromList?: boolean): void;
  closeThread(): void;
  openThreadsList(): void;
  closeThreadsList(): void;
  reset(): void;
}

export const useChatSidePanel = create<ChatSidePanelState>((set) => ({
  threadRootId: "",
  threadRoot: undefined,
  threadsListOpen: false,
  threadFromList: false,
  openThread: (threadRootId, threadRoot, fromList = false) =>
    set({ threadRootId, threadRoot, threadsListOpen: false, threadFromList: fromList }),
  closeThread: () => set({ threadRootId: "", threadRoot: undefined }),
  openThreadsList: () => set({ threadsListOpen: true, threadRootId: "", threadRoot: undefined }),
  closeThreadsList: () => set({ threadsListOpen: false }),
  reset: () =>
    set({ threadRootId: "", threadRoot: undefined, threadsListOpen: false, threadFromList: false }),
}));

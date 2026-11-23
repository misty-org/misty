import { create } from "zustand";
import type { SpaceMessage } from "../api/dto/entities";

interface ChatSidePanelState {
  threadRootId: string;
  threadRoot: SpaceMessage | undefined;
  threadsListOpen: boolean;
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

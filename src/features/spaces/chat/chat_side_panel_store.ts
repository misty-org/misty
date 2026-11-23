import { create } from "zustand";
import type { SpaceMessage } from "../api/dto/entities";

interface ChatSidePanelState {
  threadRootId: string;
  threadRoot: SpaceMessage | undefined;
  threadsListOpen: boolean;
  threadFromList: boolean;
  pinnedOpen: boolean;
  openThread(rootId: string, root?: SpaceMessage, fromList?: boolean): void;
  closeThread(): void;
  openThreadsList(): void;
  closeThreadsList(): void;
  openPinned(): void;
  closePinned(): void;
  reset(): void;
}

export const useChatSidePanel = create<ChatSidePanelState>((set) => ({
  threadRootId: "",
  threadRoot: undefined,
  threadsListOpen: false,
  threadFromList: false,
  pinnedOpen: false,
  openThread: (threadRootId, threadRoot, fromList = false) =>
    set({
      threadRootId,
      threadRoot,
      threadsListOpen: false,
      threadFromList: fromList,
      pinnedOpen: false,
    }),
  closeThread: () => set({ threadRootId: "", threadRoot: undefined }),
  openThreadsList: () =>
    set({ threadsListOpen: true, threadRootId: "", threadRoot: undefined, pinnedOpen: false }),
  closeThreadsList: () => set({ threadsListOpen: false }),
  openPinned: () =>
    set({
      pinnedOpen: true,
      threadRootId: "",
      threadRoot: undefined,
      threadsListOpen: false,
      threadFromList: false,
    }),
  closePinned: () => set({ pinnedOpen: false }),
  reset: () =>
    set({
      threadRootId: "",
      threadRoot: undefined,
      threadsListOpen: false,
      threadFromList: false,
      pinnedOpen: false,
    }),
}));

import { create } from "zustand";

/** What the panel beside a chat can show. */
export type ContextPanelTab = "files" | "changes" | "terminal";

/** Which tab of the context panel is open in this window, if any. Pressing the open one closes it. */
export const useContextPanel = create<{
  tab: ContextPanelTab | null;
  toggle(tab: ContextPanelTab): void;
  show(tab: ContextPanelTab): void;
}>((set, get) => ({
  tab: null,
  toggle: (tab) => set({ tab: get().tab === tab ? null : tab }),
  show: (tab) => set({ tab }),
}));

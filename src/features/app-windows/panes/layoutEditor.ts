import { create } from "zustand";

/**
 * Whether the window is in layout mode: the page stays visible with a drop zone on every side of
 * every pane, tabs are dragged from the sidebar onto them, and new tabs open as usual. It lasts
 * until Done or Escape.
 */
export const useLayoutEditor = create<{ active: boolean; toggle(): void; stop(): void }>((set) => ({
  active: false,
  toggle: () => set((state) => ({ active: !state.active })),
  stop: () => set({ active: false }),
}));

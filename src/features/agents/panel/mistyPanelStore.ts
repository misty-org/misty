import { create } from "zustand";

interface MistyPanelState {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
}

/** The Misty panel beside the workspace: opens only when asked, by shortcut or the browser's Misty button. */
export const useMistyPanelStore = create<MistyPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));

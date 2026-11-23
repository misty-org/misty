import { create } from "zustand";

export const useLayoutEditor = create<{ active: boolean; toggle(): void; stop(): void }>((set) => ({
  active: false,
  toggle: () => set((state) => ({ active: !state.active })),
  stop: () => set({ active: false }),
}));

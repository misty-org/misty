import { create } from "zustand";

/** The project review sheet: one project's uncommitted changes, history and Git actions. */
export const useProjectReview = create<{
  scopeId: string | null;
  open(scopeId: string): void;
  close(): void;
}>((set) => ({
  scopeId: null,
  open: (scopeId) => set({ scopeId }),
  close: () => set({ scopeId: null }),
}));

import { create } from "zustand";

/** What the recorder last said, in plain words, for Settings › Memory. */
export const useRecallStore = create<{
  notice: string | null;
  setNotice(notice: string | null): void;
}>((set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
}));

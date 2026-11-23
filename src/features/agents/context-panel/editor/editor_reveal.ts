import { create } from "zustand";

export const useEditorReveal = create<{
  target: { path: string; line: number } | null;
  reveal(path: string, line: number): void;
  clear(): void;
}>((set) => ({
  target: null,
  reveal: (path, line) => set({ target: { path, line } }),
  clear: () => set({ target: null }),
}));

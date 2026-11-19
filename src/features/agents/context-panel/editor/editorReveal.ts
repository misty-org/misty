import { create } from "zustand";

/**
 * A line to show once its file's editor is up: a search result opens its file, and the editor
 * that shows that file puts the cursor on the line, scrolls it into view and clears the request.
 */
export const useEditorReveal = create<{
  target: { path: string; line: number } | null;
  reveal(path: string, line: number): void;
  clear(): void;
}>((set) => ({
  target: null,
  reveal: (path, line) => set({ target: { path, line } }),
  clear: () => set({ target: null }),
}));

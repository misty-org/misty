import { create } from "zustand";
import { browserSearchUrl } from "@/features/workspace/browserSearchEngine";
import { resolveDirectAddress } from "./address";

/** Where the panel opens when the address bar summons it, instead of the page's top. */
export type SearchAnchor = {
  left: number;
  top: number;
  width: number;
  /** Takes the chosen address, so the current tab navigates rather than a new one opening. */
  openUrl(url: string): void;
};

export const useBrowserSearchStore = create<{
  open: boolean;
  anchor: SearchAnchor | null;
  show(anchor?: SearchAnchor): void;
  close(): void;
  toggle(): void;
}>((set) => ({
  open: false,
  anchor: null,
  show: (anchor) => set({ open: true, anchor: anchor ?? null }),
  close: () => set({ open: false, anchor: null }),
  toggle: () => set((state) => ({ open: !state.open, anchor: null })),
}));

/** Enter submits the typed URL, or the phrase to the person's search engine.
 * The launcher never evaluates a typed script URL. */
export function browserSearchDestination(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const direct = resolveDirectAddress(value);
  if (direct) {
    const url = new URL(direct);
    if (url.protocol === "http:" || url.protocol === "https:" || url.href === "about:blank")
      return url.href;
  }
  return browserSearchUrl(value);
}

import { create } from "zustand";
import { browserSearchUrl } from "@/features/workspace/browserSearchEngine";
import { resolveDirectAddress } from "./address";
import type { SearchScope } from "./bangs/types";

export const useBrowserSearchStore = create<{
  open: boolean;
  /** The scope the dialog opened in, such as open tabs; null for the address search. */
  scope: SearchScope | null;
  show(scope?: SearchScope): void;
  close(): void;
  toggle(): void;
}>((set) => ({
  open: false,
  scope: null,
  show: (scope) => set({ open: true, scope: scope ?? null }),
  close: () => set({ open: false, scope: null }),
  toggle: () => set((state) => ({ open: !state.open, scope: null })),
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

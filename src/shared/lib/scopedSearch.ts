import type { ReactNode } from "react";
import { create } from "zustand";

/** One thing a scoped search found, ready to show and open. */
export interface ScopedSearchHit {
  id: string;
  title: string;
  /** Where it is, shown at the right, such as a file's folder. */
  detail?: string;
  icon: ReactNode;
  open(): void;
}

/**
 * A page's own items, searched in the ⌘K box under a chip (⌘P on the Code page: the folder's
 * files). Backspace on the empty field drops the chip and the box searches everything again.
 */
export interface SearchScope {
  /** The chip's words, such as "misty files". */
  label: string;
  /** The field's words while it is empty, such as "Go to file". */
  placeholder: string;
  search(text: string): ScopedSearchHit[];
  /** Calls back when what `search` reads has changed (an index finished loading). */
  subscribe?(onChange: () => void): () => void;
}

/**
 * Asks the window's ⌘K box to open scoped to a page's items. The box lives in the app's layout,
 * which watches `request` (bumped by `nonce` so the same scope can open twice).
 */
export const useScopedSearch = create<{
  request: SearchScope | null;
  nonce: number;
  open(scope: SearchScope): void;
}>((set) => ({
  request: null,
  nonce: 0,
  open: (scope) => set((state) => ({ request: scope, nonce: state.nonce + 1 })),
}));

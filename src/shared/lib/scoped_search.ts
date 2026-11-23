import type { ReactNode } from "react";
import { create } from "zustand";

export interface ScopedSearchHit {
  id: string;
  title: string;
  detail?: string;
  icon: ReactNode;
  open(): void;
}

export interface SearchScope {
  label: string;
  placeholder: string;
  search(text: string): ScopedSearchHit[];
  subscribe?(onChange: () => void): () => void;
}

export const useScopedSearch = create<{
  request: SearchScope | null;
  nonce: number;
  open(scope: SearchScope): void;
}>((set) => ({
  request: null,
  nonce: 0,
  open: (scope) => set((state) => ({ request: scope, nonce: state.nonce + 1 })),
}));

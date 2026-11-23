// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { filesApi, type FileIndexEntry } from "./files_api";

export interface IndexEntry {
  rel: string;
  name: string;
  isDir: boolean;
  depth: number;
  key: string;
  nameStart: number;
}

export const SEARCH_RESULT_LIMIT = 50;
const FRESH_FOR_MS = 60_000;

function buildEntries(raw: FileIndexEntry[]): IndexEntry[] {
  const entries = raw.map(({ rel, isDir }) => {
    const slash = rel.lastIndexOf("/");
    return {
      rel,
      name: slash >= 0 ? rel.slice(slash + 1) : rel,
      isDir,
      depth: rel.split("/").length - 1,
      key: rel.toLowerCase(),
      nameStart: slash + 1,
    };
  });
  entries.sort((a, b) => a.depth - b.depth || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries;
}

interface RootIndex {
  entries: IndexEntry[];
  loadedAt: number;
  loading: boolean;
}

export const useFileIndex = create<{
  byRoot: Record<string, RootIndex>;
  ensure(root: string): void;
  invalidate(root: string): void;
}>((set, get) => ({
  byRoot: {},
  ensure(root) {
    const known = get().byRoot[root];
    if (known && (known.loading || Date.now() - known.loadedAt < FRESH_FOR_MS)) return;
    set((state) => ({
      byRoot: {
        ...state.byRoot,
        [root]: { entries: known?.entries ?? [], loadedAt: known?.loadedAt ?? 0, loading: true },
      },
    }));
    void filesApi
      .fileIndex(root)
      .then(buildEntries)
      .then(
        (entries) =>
          set((state) => ({
            byRoot: { ...state.byRoot, [root]: { entries, loadedAt: Date.now(), loading: false } },
          })),
        () =>
          set((state) => ({
            byRoot: {
              ...state.byRoot,
              [root]: { entries: known?.entries ?? [], loadedAt: Date.now(), loading: false },
            },
          })),
      );
  },
  invalidate(root) {
    const known = get().byRoot[root];
    if (!known) return;
    set((state) => ({ byRoot: { ...state.byRoot, [root]: { ...known, loadedAt: 0 } } }));
  },
}));

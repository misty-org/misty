// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { filesApi, type FileIndexEntry } from "./filesApi";

/**
 * Every file and folder under a linked folder, for the search overlay: fetched once per folder (a
 * single bounded walk natively) and fetched again in the background once it is a minute old,
 * while the old list stays in use. Matching is plain JavaScript over lowercase keys made here.
 */
export interface IndexEntry {
  /** Relative to the folder, `/` between names. */
  rel: string;
  name: string;
  isDir: boolean;
  /** How many folders deep; an empty query would list the shallowest first. */
  depth: number;
  /** `rel` in lowercase, what queries are matched against. */
  key: string;
  /** Where the name starts inside `key`. */
  nameStart: number;
}

/** Most rows the overlay shows, whatever matches. */
export const SEARCH_RESULT_LIMIT = 50;
const FRESH_FOR_MS = 60_000;

export function buildEntries(raw: FileIndexEntry[]): IndexEntry[] {
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
  /** Forget a folder's list, after files were made, renamed or removed. */
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

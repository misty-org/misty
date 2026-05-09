import { create } from "zustand";
import { codeGitDiff, codeGitStatus, type GitStatusSnapshot } from "../native";

interface GitState {
  snapshot: GitStatusSnapshot | null;
  snapshots: Record<string, GitStatusSnapshot>;
  loading: boolean;
  loadingRoots: Record<string, boolean>;
  error: string | null;
  diffs: Record<string, GitDiff>;
  refresh: (root: string) => Promise<void>;
  refreshDiff: (root: string, path: string) => Promise<void>;
  clear: (root?: string) => void;
}

export interface GitDiff {
  additions: Set<number>;
  modifications: Set<number>;
  deletions: Set<number>;
  version: number;
}

export const useGitStore = create<GitState>((set, get) => ({
  snapshot: null,
  snapshots: {},
  loading: false,
  loadingRoots: {},
  error: null,
  diffs: {},

  refresh: async (root) => {
    if (get().loadingRoots[root]) return;
    set((state) => ({
      loading: true,
      loadingRoots: { ...state.loadingRoots, [root]: true },
      error: null,
    }));
    try {
      const snapshot = await codeGitStatus(root);
      set((state) => ({
        snapshot,
        snapshots: { ...state.snapshots, [root]: snapshot },
        loading: false,
        loadingRoots: { ...state.loadingRoots, [root]: false },
      }));
    } catch (error) {
      set((state) => ({
        loading: false,
        loadingRoots: { ...state.loadingRoots, [root]: false },
        error: error instanceof Error ? error.message : "Could not read git status.",
      }));
    }
  },

  refreshDiff: async (root, path) => {
    try {
      const text = await codeGitDiff(root, path);
      const parsed = parseUnifiedDiff(text);
      set((state) => ({
        diffs: {
          ...state.diffs,
          [path]: {
            ...parsed,
            version: (state.diffs[path]?.version ?? 0) + 1,
          },
        },
      }));
    } catch {
      /* file may not be tracked yet; leave previous diff in place */
    }
  },

  clear: (root) =>
    set((state) => {
      if (!root) return { snapshot: null, snapshots: {}, diffs: {}, error: null };
      const snapshots = { ...state.snapshots };
      delete snapshots[root];
      return {
        snapshots,
        snapshot: state.snapshot === state.snapshots[root] ? null : state.snapshot,
      };
    }),
}));

function parseUnifiedDiff(text: string): {
  additions: Set<number>;
  modifications: Set<number>;
  deletions: Set<number>;
} {
  const additions = new Set<number>();
  const modifications = new Set<number>();
  const deletions = new Set<number>();
  if (!text) return { additions, modifications, deletions };
  const lines = text.split("\n");
  let currentLine = 0;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (match) {
        currentLine = Number.parseInt(match[1] ?? "0", 10);
      }
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      additions.add(currentLine);
      currentLine += 1;
    } else if (line.startsWith("-")) {
      deletions.add(currentLine);
    } else if (line.startsWith(" ")) {
      currentLine += 1;
    }
  }
  // Any line that had both +/- treated as modification
  for (const line of additions) {
    if (deletions.has(line)) modifications.add(line);
  }
  for (const line of modifications) {
    additions.delete(line);
  }
  return { additions, modifications, deletions };
}

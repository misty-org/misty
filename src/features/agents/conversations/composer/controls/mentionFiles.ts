// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useFileIndex, type IndexEntry } from "../../../context-panel/files/fileIndex";

/**
 * The composer's `@` menu reads the file panel's index (`project_file_index`, `.gitignore`-aware):
 * fetched once per folder and refreshed in the background, so typing never waits on a walk.
 * Matching is a subsequence score over the cached lowercase keys.
 */

/** Most rows the `@` menu shows. */
const MENTION_MENU_LIMIT = 50;

/** Starts loading a folder's index, so the first `@` is instant. */
export const prefetchMentionIndex = (root: string) => {
  if (root) useFileIndex.getState().ensure(root);
};

/** The folder's index once it has loaded at least once (the old one while it refreshes). */
export function mentionIndex(root: string): Promise<IndexEntry[]> {
  const store = useFileIndex;
  store.getState().ensure(root);
  const ready = (state = store.getState()) => {
    const known = state.byRoot[root];
    return known && (!known.loading || known.loadedAt > 0) ? known.entries : undefined;
  };
  const now = ready();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const stop = store.subscribe((state) => {
      const entries = ready(state);
      if (!entries) return;
      stop();
      resolve(entries);
    });
  });
}

/**
 * Subsequence score for one entry; null when `q` is not a subsequence of its path. Contiguous runs,
 * segment starts and matches inside the name score higher; a small length penalty prefers short paths.
 */
function scoreEntry(entry: IndexEntry, q: string): number | null {
  const key = entry.key;
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  for (let i = 0; i < key.length && qi < q.length; i++) {
    if (key.charCodeAt(i) !== q.charCodeAt(qi)) continue;
    score += 1;
    if (i === prevMatch + 1) score += 4;
    if (i === 0 || "/-_ .".includes(key[i - 1])) score += 8;
    if (i >= entry.nameStart) score += 3;
    prevMatch = i;
    qi++;
  }
  if (qi < q.length) return null;
  return score - key.length * 0.05;
}

/**
 * Best matches for the typed query. An absolute path inside `root` (a half-typed mention) matches
 * by its part below the root; an empty query lists the shallowest entries.
 */
export function matchMentionEntries(
  entries: IndexEntry[],
  root: string,
  query: string,
  limit = MENTION_MENU_LIMIT,
): IndexEntry[] {
  let q = query.replace(/\\/g, "/").toLowerCase();
  if (!q) return entries.slice(0, limit);
  const rootKey = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (q.startsWith("/") || /^[a-z]:\//.test(q)) {
    if (q === rootKey) return entries.slice(0, limit);
    if (!q.startsWith(rootKey + "/")) return [];
    q = q.slice(rootKey.length + 1);
  }
  const scored: Array<{ entry: IndexEntry; score: number }> = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, q);
    if (score !== null) scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.entry.depth - b.entry.depth || (a.entry.key < b.entry.key ? -1 : 1),
  );
  return scored.slice(0, limit).map((row) => row.entry);
}

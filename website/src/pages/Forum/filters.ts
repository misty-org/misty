import type { SortKey, Thread } from "./types";

/** Case-insensitive match across title, body, and author. */
export function searchThreads(list: Thread[], query: string): Thread[] {
  if (!query) return list;
  const needle = query.toLowerCase();
  return list.filter(
    (thread) =>
      thread.title.toLowerCase().includes(needle) ||
      thread.body.toLowerCase().includes(needle) ||
      thread.author.toLowerCase().includes(needle),
  );
}

/** Pinned threads always lead, and the rest follow the chosen sort. */
export function sortThreads(list: Thread[], key: SortKey): Thread[] {
  const pinned = list.filter((thread) => thread.pinned);
  const rest = list.filter((thread) => !thread.pinned);
  const sorted = [...rest].sort((a, b) => {
    if (key === "popular") return b.views - a.views;
    if (key === "top") return b.replies.length - a.replies.length;
    return b.id - a.id;
  });
  return [...pinned, ...sorted];
}

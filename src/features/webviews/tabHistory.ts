import type { BrowserHistory } from "./browserRuntime";

/** Size budget for one tab's saved history. Settings → Browser controls it;
 * 1 MB is the ceiling so saved history never costs much memory or storage. */
export const TAB_HISTORY_MAX_KB = 1024;
export const TAB_HISTORY_DEFAULT_KB = 256;
let budgetBytes = TAB_HISTORY_DEFAULT_KB * 1024;

export function configureTabHistoryBudget(kb: number) {
  const clamped = Number.isFinite(kb)
    ? Math.min(TAB_HISTORY_MAX_KB, Math.max(16, kb))
    : TAB_HISTORY_DEFAULT_KB;
  budgetBytes = Math.round(clamped) * 1024;
}

export const tabHistoryBudgetBytes = () => budgetBytes;

const syncable = (url: string) => /^https?:\/\//i.test(url) && url.length <= 8192;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/**
 * Encodes a tab's history for its synced slot. Only web addresses travel
 * (Misty's internal pages stay local), and the oldest entries are dropped
 * until it fits the budget. Returns null when nothing is worth saving.
 */
export function encodeTabHistory(history: BrowserHistory, budget = budgetBytes): string | null {
  const kept: string[] = [];
  let index = -1;
  history.entries.forEach((url, i) => {
    if (!syncable(url)) return;
    if (i <= history.index) index = kept.length;
    kept.push(url);
  });
  if (index < 0 || kept.length < 2) return null;
  // Each entry costs its JSON-encoded bytes plus a separator. Drop from the
  // oldest end, then (rarely) the far forward end, in one linear pass.
  const cost = kept.map((url) => byteLength(JSON.stringify(url)) + 1);
  const overhead = byteLength(JSON.stringify({ v: 1, entries: [], index: 0 })) + 16;
  let total = overhead + cost.reduce((sum, c) => sum + c, 0);
  let start = 0;
  let end = kept.length;
  while (total > budget && end - start > 1) {
    if (index > start) total -= cost[start++];
    else total -= cost[--end];
  }
  const entries = kept.slice(start, end);
  const encoded = JSON.stringify({ v: 1, entries, index: index - start });
  return byteLength(encoded) <= budget ? encoded : null;
}

/** Decodes a saved history and lines it up with the page the tab shows now. */
export function decodeTabHistory(raw: string, currentUrl: string): BrowserHistory | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const value = parsed as { v?: unknown; entries?: unknown; index?: unknown };
  if (value.v !== 1 || !Array.isArray(value.entries) || typeof value.index !== "number")
    return null;
  const entries = value.entries.filter(
    (url): url is string => typeof url === "string" && syncable(url),
  );
  if (entries.length !== value.entries.length || entries.length === 0) return null;
  let index = Math.min(Math.max(0, Math.trunc(value.index)), entries.length - 1);
  if (entries[index] !== currentUrl) {
    const found = entries.lastIndexOf(currentUrl);
    if (found >= 0) index = found;
    else {
      // The tab moved on since the save: keep the past, then the current page.
      entries.splice(index + 1, entries.length, currentUrl);
      index = entries.length - 1;
    }
  }
  return { entries, index };
}

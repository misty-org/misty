// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * Prompt history for the message box: what the person sent, kept in this device's browser
 * storage and never synced, for Up and Down recall and prefix completion. Items are kept newest
 * last, and a count per text ranks completion candidates.
 */

const ITEMS_KEY = "misty.promptHistory";
const COUNTS_KEY = "misty.promptHistoryCounts";
const ENABLED_KEY = "misty.promptHistoryEnabled";
const CHANGED_EVENT = "misty:prompt-history-changed";

/** Storage can be missing or throw (private windows, cleared site data): history is then empty. */
function readStoredJson<T>(key: string, validate: (value: unknown) => T | null): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? validate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw === null || raw === undefined ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Quota or private mode: history just isn't kept this time.
  }
}

const MAX_ITEMS = 200;
const MAX_TEXT_LENGTH = 300;

let cachedItems: string[] | null = null;
let cachedCounts: Record<string, number> | null = null;

function validateItems(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
  return value as string[];
}

function validateCounts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!Object.values(value).every((v) => typeof v === "number")) return null;
  return value as Record<string, number>;
}

/** All recorded prompts, oldest first (newest is the last element). */
export function getPromptHistory(): string[] {
  if (!cachedItems) cachedItems = readStoredJson(ITEMS_KEY, validateItems) ?? [];
  return cachedItems;
}

/** Usage count per prompt text; ranks ghost-completion candidates. */
export function getPromptCounts(): Record<string, number> {
  if (!cachedCounts) cachedCounts = readStoredJson(COUNTS_KEY, validateCounts) ?? {};
  return cachedCounts;
}

export function recordPrompt(text: string): void {
  const entry = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!entry) return;
  const items = getPromptHistory();
  const existing = items.indexOf(entry);
  if (existing !== -1) items.splice(existing, 1);
  items.push(entry);
  while (items.length > MAX_ITEMS) items.shift();
  const counts = getPromptCounts();
  counts[entry] = (counts[entry] ?? 0) + 1;
  writeStored(ITEMS_KEY, JSON.stringify(items));
  writeStored(COUNTS_KEY, JSON.stringify(counts));
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}
/** Remove one entry (and its usage count). */
export function deletePrompt(text: string): void {
  const items = getPromptHistory();
  const index = items.indexOf(text);
  if (index === -1) return;
  items.splice(index, 1);
  const counts = getPromptCounts();
  delete counts[text];
  writeStored(ITEMS_KEY, JSON.stringify(items));
  writeStored(COUNTS_KEY, JSON.stringify(counts));
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** Wipe all history and counts. */
export function clearPromptHistory(): void {
  cachedItems = [];
  cachedCounts = {};
  writeStored(ITEMS_KEY, "[]");
  writeStored(COUNTS_KEY, "{}");
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** Settings list: every prompt with its usage count, most-used first. */
export function getPromptHistoryWithCounts(): { text: string; count: number }[] {
  const counts = getPromptCounts();
  return getPromptHistory()
    .map((text) => ({ text, count: counts[text] ?? 1 }))
    .sort((a, b) => b.count - a.count);
}

/** Master switch for ghost completion + ArrowUp/ArrowDown recall. */
export function isPromptHistoryEnabled(): boolean {
  return readStoredBool(ENABLED_KEY, true);
}

export function setPromptHistoryEnabled(enabled: boolean): void {
  writeStored(ENABLED_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/**
 * Subscribe to in-session history changes (fired synchronously by
 * recordPrompt). Returns an unsubscribe function.
 */
export function subscribePromptHistory(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHANGED_EVENT, listener);
}

export const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * Best ghost completion for `query`: a history entry that starts with the
 * query (case-insensitive) and is longer than it, ranked by usage count
 * (desc) then shorter first. Returns the full entry, or null.
 */
export function findPromptCompletion(query: string, minQueryLength = 2): string | null {
  const clean = query.replace(INVISIBLE_CHARS_RE, "").trim();
  if (clean.length < minQueryLength) return null;
  const lower = clean.toLowerCase();
  const counts = getPromptCounts();
  let best: string | null = null;
  for (const item of getPromptHistory()) {
    if (item.length <= clean.length) continue;
    if (!item.toLowerCase().startsWith(lower)) continue;
    const count = counts[item] ?? 0;
    const bestCount = best !== null ? (counts[best] ?? 0) : -1;
    if (count > bestCount || (count === bestCount && best !== null && item.length < best.length)) {
      best = item;
    }
  }
  return best;
}

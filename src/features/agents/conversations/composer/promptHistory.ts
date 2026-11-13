// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * Prompt history for the message box: what the person sent, kept in this device's browser
 * storage and never synced, for Up and Down recall. Items are kept newest last.
 */

const ITEMS_KEY = "misty.promptHistory";
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

function validateItems(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
  return value as string[];
}

/** All recorded prompts, oldest first (newest is the last element). */
export function getPromptHistory(): string[] {
  if (!cachedItems) cachedItems = readStoredJson(ITEMS_KEY, validateItems) ?? [];
  return cachedItems;
}

export function recordPrompt(text: string): void {
  const entry = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!entry) return;
  const items = getPromptHistory();
  const existing = items.indexOf(entry);
  if (existing !== -1) items.splice(existing, 1);
  items.push(entry);
  while (items.length > MAX_ITEMS) items.shift();
  writeStored(ITEMS_KEY, JSON.stringify(items));
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

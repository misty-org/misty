// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * Prompt history for the message box: what the person sent, kept for the device in misty.db and
 * never synced, for Up and Down recall. Items are kept newest last.
 */

const CHANGED_EVENT = "misty:prompt-history-changed";
const MAX_ITEMS = 200;
const MAX_TEXT_LENGTH = 300;

const savedHistory = createDeviceSetting<string[]>({
  scope: "prompt-history",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === "string").slice(-MAX_ITEMS)
      : [],
  legacyKey: "misty.promptHistory",
});

let cachedItems: string[] | null = null;

// misty.db answers after the first frame, and another window's prompts arrive later.
savedHistory.subscribe((state) => {
  if (!state.loaded) return;
  cachedItems = state.value.slice();
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
});

/** All recorded prompts, oldest first (newest is the last element). */
export function getPromptHistory(): string[] {
  if (!cachedItems) cachedItems = savedHistory.getState().value.slice();
  return cachedItems;
}

export function recordPrompt(text: string): void {
  const entry = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!entry) return;
  // Added onto the stored list, so two windows sending at once both keep their prompt.
  savedHistory.getState().set((current) => {
    const items = current.filter((item) => item !== entry);
    items.push(entry);
    return items.slice(-MAX_ITEMS);
  });
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

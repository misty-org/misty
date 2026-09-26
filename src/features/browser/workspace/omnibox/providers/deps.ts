import type { BrowserHistorySuggestion } from "../../../library/native";

/**
 * Everything providers read from the rest of Misty. The address bar wires the
 * real sources (workspace store, browser library, settings); tests pass fakes.
 */
export interface OmniboxDeps {
  searchEngine(): { id: string; name: string };
  searchUrl(text: string): string;
  /** The person opted in to sending typed text to their search engine. */
  searchSuggestionsEnabled(): boolean;
  fetchSearchSuggestions(engine: string, text: string): Promise<string[]>;
  /** Durable history for a profile; empty text returns top pages. */
  historySuggestions(request: {
    profileId?: string;
    text: string;
    limit: number;
  }): Promise<BrowserHistorySuggestion[]>;
  /** Saved websites (bookmarks), from the synced workspace. */
  bookmarks(): { url: string; title: string }[];
  /** Misty content on this device (notes, Spaces, Library items) matching the text. */
  mistyContent(text: string, limit: number): { id: string; title: string; detail: string; route: string }[];
  /** A web address on the clipboard, read locally; null when there is none. */
  clipboardUrl(): Promise<string | null>;
  /** Browser tabs in every window, from the synced workspace. */
  openTabs(): {
    tabId: string;
    url: string;
    title: string;
    profileId?: string;
    private: boolean;
    agentOwned: boolean;
  }[];
}

/** Resolves after `ms`, or rejects once `signal` aborts, so providers can debounce. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * The address bar's autocomplete model, after Chrome's omnibox: independent
 * providers each return scored matches for the typed text, and a controller
 * merges them into one ranked list. Providers never render or navigate; the
 * view turns the chosen match's target into an action.
 */

export interface OmniboxInput {
  /** What the person typed, untrimmed. Empty when the address bar was just focused. */
  text: string;
  /** The browser tab whose address bar this is. */
  tabId: string;
  /** The page the tab shows now; never suggested back to itself. */
  currentUrl: string;
  profileId?: string;
  /** Private tabs send nothing to search engines and read no durable history. */
  private: boolean;
  /** The tab's own back/forward list, oldest first. */
  sessionHistory: string[];
}

export type OmniboxTarget =
  | { type: "navigate"; url: string }
  | { type: "switch-tab"; tabId: string; url: string }
  /** A place inside Misty, such as a note; `url` is its app route. */
  | { type: "open-in-app"; url: string };

export type OmniboxMatchKind =
  | "url"
  | "history"
  | "bookmark"
  | "tab"
  | "search"
  | "suggestion"
  | "action"
  | "content";

export interface OmniboxMatch {
  /** Stable across updates, so the highlighted row survives slower results arriving. */
  id: string;
  kind: OmniboxMatchKind;
  title: string;
  detail: string;
  target: OmniboxTarget;
  /** Higher ranks first. Roughly Chrome's scale: what-you-typed sits near 1100–1300. */
  relevance: number;
  /**
   * Whether this match may be the default (first) row, which Enter picks. Only
   * what-you-typed and inline-completable matches may; the rest rank below.
   */
  allowedToBeDefault: boolean;
  /** Text appended after the typed text when this match is the default. */
  inlineCompletion?: string;
  /** The row can be removed from history (Shift+Delete). */
  removable?: boolean;
  /** The page is also open in this tab; the row offers to switch to it. */
  switchTabId?: string;
  /** The page is saved as a bookmark. */
  bookmarked?: boolean;
  faviconUrl?: string | null;
}

export interface OmniboxProvider {
  id: string;
  /**
   * Returns matches for the input. Synchronous providers return an array and
   * show on the first frame; asynchronous ones resolve later and are merged in.
   * Providers must honour `signal` and must not throw for ordinary failures.
   */
  start(input: OmniboxInput, signal: AbortSignal): OmniboxMatch[] | Promise<OmniboxMatch[]>;
}

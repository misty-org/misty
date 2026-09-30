import type { PageDocument } from "@/features/workspace/pageSnapshot";
export interface BrowserHistory {
  entries: string[];
  index: number;
  /** Entries the webview's own history also holds. Misty's back/forward uses
   * the webview inside this range and loads the URL directly outside it
   * (entries synced from another device, or from before a restart). */
  native?: { lo: number; hi: number };
}

/** Where a back/forward step goes, and whether the webview can take it. */
export interface HistoryStep {
  url: string;
  native: boolean;
}

export interface BrowserCompatibilityIssue {
  kind: "cloudflare_challenge";
  url: string;
}

export interface PagePreview {
  url: string;
  dataUrl?: string;
  document?: PageDocument | null;
}

export interface BrowserInspection {
  url?: string;
  title?: string;
  text?: string;
  truncated?: boolean;
  interactive?: BrowserInteractiveControl[];
}

export interface BrowserInteractiveControl {
  ref: string;
  tag: string;
  role: string;
  name: string;
}

export interface BrowserMistyPage {
  title: string;
  text: string;
  truncated: boolean;
  urlFingerprint: string;
  interactive: BrowserInteractiveControl[];
}

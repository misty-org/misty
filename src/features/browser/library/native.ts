import { invoke } from "@tauri-apps/api/core";

export type BrowserDownloadState =
  | "in_progress"
  | "finished"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface BrowserDownloadEntry {
  id: string;
  url: string;
  path: string;
  fileName: string;
  state: BrowserDownloadState;
  error: string | null;
  received: number;
  /** -1 when the size is unknown. */
  total: number;
  startedAt: number;
  finishedAt: number | null;
  /** Whether a finished file is still where it was saved. */
  exists: boolean;
}

export interface BrowserDownloadProgress {
  id: string;
  received: number;
  total: number;
}

export interface BrowserHistoryVisit {
  id: number;
  url: string;
  title: string;
  visitedAt: number;
}

export interface BrowserHistorySuggestion {
  url: string;
  title: string;
  visits: number;
  /** Visits where the person typed the address. */
  typedVisits: number;
  lastVisitedAt: number;
}

export interface BrowserFindResult {
  current: number;
  total: number;
}

export type BrowserWebsiteDataKind = "cookies" | "cache";

export const browserLibrary = {
  downloads: () => invoke<BrowserDownloadEntry[]>("browser_downloads_list"),
  downloadProgress: () => invoke<BrowserDownloadProgress[]>("browser_downloads_progress"),
  cancelDownload: (id: string) => invoke<void>("browser_download_cancel", { request: { id } }),
  openDownload: (id: string) => invoke<void>("browser_download_open", { request: { id } }),
  revealDownload: (id: string) => invoke<void>("browser_download_reveal", { request: { id } }),
  removeDownloads: (request: { ids?: string[]; since?: number }) =>
    invoke<void>("browser_downloads_remove", { request: { ids: request.ids ?? [], since: request.since } }),

  recordVisit: (request: { profileId?: string; url: string; title: string; typed?: boolean }) =>
    invoke<void>("browser_history_record", { request }),
  setVisitTitle: (request: { profileId?: string; url: string; title: string }) =>
    invoke<void>("browser_history_set_title", { request }),
  history: (request: { profileId?: string; text?: string; before?: number; limit?: number }) =>
    invoke<BrowserHistoryVisit[]>("browser_history_query", { request }),
  /** Empty text returns the profile's top pages. */
  historySuggestions: (request: { profileId?: string; text: string; limit?: number }) =>
    invoke<BrowserHistorySuggestion[]>("browser_history_suggest", { request }),
  /** Removes every visit to one page. */
  forgetPage: (request: { profileId?: string; url: string }) =>
    invoke<void>("browser_history_forget", { request }),
  deleteVisits: (ids: number[]) => invoke<void>("browser_history_delete", { request: { ids } }),
  clearHistory: (request: { profileId?: string; since?: number }) =>
    invoke<void>("browser_history_clear", { request }),

  clearWebsiteData: (request: {
    profileId?: string;
    kinds: BrowserWebsiteDataKind[];
    since: number;
  }) => invoke<void>("browser_clear_website_data", { request }),
};

export const browserPageTools = {
  stop: (id: string) => invoke<void>("browser_webview_stop", { request: { id } }),
  find: (id: string, query: string, direction: "next" | "previous" | "clear") =>
    invoke<BrowserFindResult>("browser_webview_find", { request: { id, query, direction } }),
  print: (id: string) => invoke<void>("browser_webview_print", { request: { id } }),
  savePage: (id: string, path: string) =>
    invoke<void>("browser_webview_save_page", { request: { id, path } }),
  developerTools: (id: string) =>
    invoke<{ opened: boolean }>("browser_webview_developer_tools", { request: { id } }),
};

import { invoke } from "@tauri-apps/api/core";

export type BrowserWebsiteDataKind = "cookies" | "cache";

/** What this computer keeps from web pages, for clearing it. */
export const browserLibrary = {
  /** Removes the list of downloads kept on this computer; the files stay on disk. */
  removeDownloads: (request: { since?: number }) =>
    invoke<void>("browser_downloads_remove", { request: { ids: [], since: request.since } }),
  /** Removes the visits recorded while Misty had tabs of a person's own. */
  clearHistory: (request: { since?: number }) => invoke<void>("browser_history_clear", { request }),
  clearWebsiteData: (request: { kinds: BrowserWebsiteDataKind[]; since: number }) =>
    invoke<void>("browser_clear_website_data", { request }),
};

export const browserPageTools = {
  readerArticle: (id: string) =>
    invoke<unknown>("browser_webview_reader_article", { request: { id } }),
};

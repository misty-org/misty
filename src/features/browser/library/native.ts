import { invoke } from "@tauri-apps/api/core";

export type BrowserWebsiteDataKind = "cookies" | "cache";

/** What this computer keeps from web pages, for clearing it. */
export const browserLibrary = {
  clearWebsiteData: (request: { kinds: BrowserWebsiteDataKind[]; since: number }) =>
    invoke<void>("browser_clear_website_data", { request }),
};

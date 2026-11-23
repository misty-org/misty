import { invoke } from "@tauri-apps/api/core";

export type BrowserWebsiteDataKind = "cookies" | "cache";

export const browserLibrary = {
  clearWebsiteData: (request: { kinds: BrowserWebsiteDataKind[]; since: number }) =>
    invoke<void>("browser_clear_website_data", { request }),
};

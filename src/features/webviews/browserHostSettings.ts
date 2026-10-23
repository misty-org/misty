import { invoke } from "@tauri-apps/api/core";

const internalPageTabs = new Set<string>();

/**
 * Marks a tab as showing a Misty-drawn page (misty://history and so on). Its
 * native page stays alive but hidden, and must not overwrite the tab's
 * address, title or icon while it sits behind the internal page.
 */
export function setBrowserTabShowsInternalPage(tabId: string, internal: boolean): void {
  if (internal) internalPageTabs.add(tabId);
  else internalPageTabs.delete(tabId);
}

export function browserTabShowsInternalPage(tabId: string): boolean {
  return internalPageTabs.has(tabId);
}

let browserDownloadDirectory: string | null = null;

/** Where website downloads are saved; empty means the Downloads folder. */
export function setBrowserDownloadDirectory(directory: string): void {
  if (browserDownloadDirectory === directory) return;
  browserDownloadDirectory = directory;
  void invoke<void>("browser_set_download_directory", { directory }).catch(() => undefined);
}

let browserDownloadPrompt: boolean | null = null;

/** Ask where to save each website download instead of saving automatically. */
export function setBrowserDownloadPrompt(enabled: boolean): void {
  if (browserDownloadPrompt === enabled) return;
  browserDownloadPrompt = enabled;
  void invoke<void>("browser_set_download_prompt", { enabled }).catch(() => undefined);
}

let browserStatusBubbleEnabled: boolean | null = null;

/** Shows or hides the hovered-link and loading bubble inside browser pages. */
export function setBrowserStatusBubbleEnabled(enabled: boolean): void {
  if (browserStatusBubbleEnabled === enabled) return;
  browserStatusBubbleEnabled = enabled;
  void invoke<void>("browser_webviews_set_status_bubble", { enabled }).catch(() => undefined);
}

import { invoke } from "@tauri-apps/api/core";

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

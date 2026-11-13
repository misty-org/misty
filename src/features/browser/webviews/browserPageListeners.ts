import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { requestBrowserWebviewLayoutByRuntimeId } from "./browserRuntimeSync";

interface BrowserPageListenerOptions {
  isDisposed: () => boolean;
}

/** Page events that ask for a page to be placed again. */
export function listenBrowserPageEvents({
  isDisposed,
}: BrowserPageListenerOptions): Promise<UnlistenFn>[] {
  return [
    // A page left full screen: its pane's bounds were ignored meanwhile, so measure them again.
    listen<{ id: string; active: boolean }>("misty://browser-fullscreen", ({ payload }) => {
      if (isDisposed() || payload.active) return;
      requestBrowserWebviewLayoutByRuntimeId(payload.id);
    }),
    // A newly created page stays parked until it paints; this brings it in.
    listen<{ id: string }>("misty://browser-reveal", ({ payload }) => {
      if (isDisposed()) return;
      requestBrowserWebviewLayoutByRuntimeId(payload.id);
    }),
  ];
}

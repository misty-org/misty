import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { requestBrowserWebviewLayoutByRuntimeId } from "./browser_runtime_sync";

interface BrowserPageListenerOptions {
  isDisposed: () => boolean;
}

export function listenBrowserPageEvents({
  isDisposed,
}: BrowserPageListenerOptions): Promise<UnlistenFn>[] {
  return [
    listen<{ id: string; active: boolean }>("misty://browser-fullscreen", ({ payload }) => {
      if (isDisposed() || payload.active) return;
      requestBrowserWebviewLayoutByRuntimeId(payload.id);
    }),
    listen<{ id: string }>("misty://browser-reveal", ({ payload }) => {
      if (isDisposed()) return;
      requestBrowserWebviewLayoutByRuntimeId(payload.id);
    }),
  ];
}

import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";

/** A native page took keyboard focus, which the renderer's DOM never hears about. Drop the DOM's
 * focus too, so a field that kept it lets go. */
function releaseRendererFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

interface BrowserInteractionListenerOptions {
  isDisposed: () => boolean;
}

/** Focus and pointer events from native pages. */
export function listenBrowserInteractionEvents({
  isDisposed,
}: BrowserInteractionListenerOptions): Promise<UnlistenFn>[] {
  return [
    listen<{ id: string }>("misty://browser-focus", () => {
      if (isDisposed()) return;
      releaseRendererFocus();
    }),
    listen<{ x: number; y: number; navigate?: "back" | "forward" }>(
      "misty://browser-page-pointer-down",
      ({ payload }) => {
        if (isDisposed()) return;
        releaseRendererFocus();
        // A mouse's back or forward side button: Go back or forward in the page just focused.
        // Loaded on use, which also lets the focus settle first.
        if (payload.navigate) {
          const command = payload.navigate === "back" ? "navigation.back" : "navigation.forward";
          void import("@/features/shortcuts").then(({ invokeShortcutCommand }) =>
            invokeShortcutCommand(command),
          );
        }
      },
    ),
  ];
}

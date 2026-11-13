import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";

/** A native page took keyboard focus, which the renderer's DOM never hears about. Drop the DOM's
 * focus too, so a field that kept it lets go. */
function releaseRendererFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

interface BrowserPointerPayload {
  x: number;
  y: number;
  inside: boolean;
}

/** Where a native page reports the pointer, in the renderer's own coordinates: native code gives
 * the window's logical points, which the app's zoom scales. `null` once the pointer has left. */
export function rendererPointer(
  payload: BrowserPointerPayload,
  appZoom: number,
): { x: number; y: number } | null {
  if (!payload.inside || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return null;
  const zoom = Number.isFinite(appZoom) && appZoom > 0 ? appZoom : 1;
  return { x: payload.x / zoom, y: payload.y / zoom };
}

interface BrowserInteractionListenerOptions {
  isDisposed: () => boolean;
}

/** Pointer and focus events from native pages. */
export function listenBrowserInteractionEvents({
  isDisposed,
}: BrowserInteractionListenerOptions): Promise<UnlistenFn>[] {
  return [
    // Native pages swallow pointer events, so the drawers that slide out over a page hear of the
    // pointer this way.
    listen<BrowserPointerPayload>("misty://browser-pointer", ({ payload }) => {
      if (isDisposed()) return;
      const point = rendererPointer(payload, getAppliedAppRenderScale());
      if (point) window.dispatchEvent(new CustomEvent("misty:browser-pointer", { detail: point }));
    }),
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

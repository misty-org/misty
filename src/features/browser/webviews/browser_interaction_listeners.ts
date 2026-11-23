import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { getAppliedAppRenderScale } from "@/shared/hooks/use_app_zoom";

function releaseRendererFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

interface BrowserPointerPayload {
  x: number;
  y: number;
  inside: boolean;
}

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

export function listenBrowserInteractionEvents({
  isDisposed,
}: BrowserInteractionListenerOptions): Promise<UnlistenFn>[] {
  return [
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

import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { dockLeaves, useWorkspaceStore } from "@/features/app-windows";
import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { browserTabIdForRuntime } from "./browserRuntime";

interface BrowserPointerEvent {
  id: string;
  x: number;
  y: number;
  inside: boolean;
}
interface BrowserFocusEvent {
  id: string;
}
/** A native page took keyboard focus, which the renderer's DOM never hears about. Drop the DOM's
 * focus too, so a field that kept it lets go. */
function releaseRendererFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

function focusBrowserRuntimeTab(runtimeId: string): boolean {
  const tabId = browserTabIdForRuntime(runtimeId);
  return tabId ? focusBrowserTab(tabId) : false;
}

/** The host reports a click on a native page before the page handles it; the
 * page host under that point names the tab whose pane becomes active. */
function focusBrowserPageAt(x: number, y: number): boolean {
  for (const host of document.querySelectorAll<HTMLElement>("[data-browser-page-host]")) {
    const rect = host.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
    const tabId = host.closest<HTMLElement>("[data-browser-workspace-tab]")?.dataset
      .browserWorkspaceTab;
    if (tabId) return focusBrowserTab(tabId);
  }
  return false;
}

function focusBrowserTab(tabId: string): boolean {
  if (!useWorkspaceStore.getState().focusView(tabId)) return false;
  window.dispatchEvent(
    new CustomEvent("misty:focus-workspace-tab", {
      detail: {
        tabId,
      },
    }),
  );
  return true;
}

interface BrowserInteractionListenerOptions {
  isDisposed: () => boolean;
}

/** Pointer, focus and permission events from native pages. */
export function listenBrowserInteractionEvents({
  isDisposed,
}: BrowserInteractionListenerOptions): Promise<UnlistenFn>[] {
  return [
    listen<BrowserPointerEvent>("misty://browser-pointer", ({ payload }) => {
      if (
        isDisposed() ||
        !payload.inside ||
        !Number.isFinite(payload.x) ||
        !Number.isFinite(payload.y)
      ) {
        return;
      }
      const tabId = browserTabIdForRuntime(payload.id);
      if (!tabId) return;
      const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find(
        (candidate) => candidate.activeViewId === tabId,
      );
      if (!pane) return;
      const workspace = document.querySelector<HTMLElement>(
        `[data-browser-workspace-tab="${CSS.escape(tabId)}"]`,
      );
      const host = workspace?.querySelector<HTMLElement>("[data-browser-page-host]");
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const x = Math.min(rect.right, Math.max(rect.left, rect.left + payload.x));
      const y = Math.min(rect.bottom, Math.max(rect.top, rect.top + payload.y));
      window.dispatchEvent(
        new CustomEvent("misty:browser-pointer", {
          detail: {
            x,
            y,
            paneId: pane.id,
          },
        }),
      );
    }),
    listen<BrowserFocusEvent>("misty://browser-focus", ({ payload }) => {
      if (isDisposed()) return;
      releaseRendererFocus();
      focusBrowserRuntimeTab(payload.id);
    }),
    listen<{ x: number; y: number; navigate?: "back" | "forward" }>(
      "misty://browser-page-pointer-down",
      ({ payload }) => {
        const scale = getAppliedAppRenderScale();
        if (isDisposed()) return;
        releaseRendererFocus();
        focusBrowserPageAt(payload.x / scale, payload.y / scale);
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

import type { DesktopPlatform } from "@/app/layouts/model";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useRef } from "react";
import { shouldSuppressWindowDrag } from "./windowChromeHelpers";

export function useTitlebarPointerHandlers(
  desktopPlatform: DesktopPlatform,
  togglePseudoMaximize: () => Promise<void>,
  toggleTitlebarMaximize: () => Promise<void>,
) {
  const lastTitlebarPressRef = useRef(0);
  const startTitlebarDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }
    if (shouldSuppressWindowDrag(event.target)) {
      return;
    }
    event.preventDefault();
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  }, []);

  // The native drag loop consumes the DOM dblclick event, so recognize the
  // second press here. Drive zoom/restore through explicit animation frames:
  // AppKit's built-in zoom snapshots WKWebView instead of giving WebKit each
  // intermediate viewport size.
  const handleMacTitlebarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (shouldSuppressWindowDrag(event.target)) return;
      event.preventDefault();
      if (!hasTauriInternals()) return;
      const now = Date.now();
      const isDoublePress = now - lastTitlebarPressRef.current <= 500;
      lastTitlebarPressRef.current = isDoublePress ? 0 : now;
      if (isDoublePress) {
        void togglePseudoMaximize().catch(() => undefined);
        return;
      }
      void getCurrentWindow()
        .startDragging()
        .catch(() => undefined);
    },
    [togglePseudoMaximize],
  );

  // Windows/Linux titlebar: drag on press, toggle native maximize on a
  // double-press. The native path preserves Windows snap behavior and its
  // minimize/maximize/restore animations.
  const handleWindowsTitlebarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (shouldSuppressWindowDrag(event.target)) return;
      event.preventDefault();
      if (!hasTauriInternals()) return;
      const now = Date.now();
      const isDoublePress = now - lastTitlebarPressRef.current <= 500;
      lastTitlebarPressRef.current = isDoublePress ? 0 : now;
      if (isDoublePress) {
        void toggleTitlebarMaximize().catch(() => undefined);
        return;
      }
      void getCurrentWindow()
        .startDragging()
        .catch(() => undefined);
    },
    [toggleTitlebarMaximize],
  );
  const handleDesktopTitlebarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (desktopPlatform === "macos") {
        handleMacTitlebarPointerDown(event);
        return;
      }
      if (desktopPlatform === "windows" || desktopPlatform === "linux") {
        handleWindowsTitlebarPointerDown(event);
        return;
      }
      startTitlebarDrag(event);
    },
    [
      desktopPlatform,
      handleMacTitlebarPointerDown,
      handleWindowsTitlebarPointerDown,
      startTitlebarDrag,
    ],
  );

  // A page's top edge is content as much as titlebar: a plain press must stay a plain press, or
  // the native drag loop it starts swallows the second press of a double-click. So the drag
  // waits for the pointer to move, and the second press zooms or restores.
  const lastTopEdgePress = useRef<{ time: number; x: number; y: number } | null>(null);
  const handleTopEdgePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !hasTauriInternals()) return;
      const { clientX: x, clientY: y } = event;
      const now = Date.now();
      const previous = lastTopEdgePress.current;
      if (
        previous &&
        now - previous.time <= 500 &&
        Math.abs(x - previous.x) + Math.abs(y - previous.y) <= 8
      ) {
        lastTopEdgePress.current = null;
        event.preventDefault();
        void (
          desktopPlatform === "macos" ? togglePseudoMaximize() : toggleTitlebarMaximize()
        ).catch(() => undefined);
        return;
      }
      lastTopEdgePress.current = { time: now, x, y };
      const stop = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", stop, true);
        window.removeEventListener("pointercancel", stop, true);
      };
      const move = (moved: PointerEvent) => {
        if ((moved.buttons & 1) === 0) return stop();
        if (Math.abs(moved.clientX - x) + Math.abs(moved.clientY - y) < 4) return;
        stop();
        lastTopEdgePress.current = null;
        void getCurrentWindow()
          .startDragging()
          .catch(() => undefined);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", stop, true);
      window.addEventListener("pointercancel", stop, true);
    },
    [desktopPlatform, togglePseudoMaximize, toggleTitlebarMaximize],
  );
  return { startTitlebarDrag, handleDesktopTitlebarPointerDown, handleTopEdgePointerDown };
}

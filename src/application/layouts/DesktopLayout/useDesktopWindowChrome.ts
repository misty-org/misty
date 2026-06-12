import type { DesktopPlatform, WindowBounds, WindowRect } from "@/application/layouts/model/types";
import { enableModernWindowStyle, repositionTrafficLights } from "@/native";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export const WINDOW_DRAG_SUPPRESS_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[draggable='true']",
  "[data-misty-window-drag-block='true']",
  "[data-pointer-drag-source='true']",
  "[data-explorer-drag-source='true']",
  "[data-reorder-drag-source='true']",
  "[data-drag-handle]",
  "[data-drag-handle='true']",
].join(",");

export function shouldSuppressWindowDrag(target: EventTarget | null) {
  const element = typeof Element === "undefined" || !(target instanceof Element) ? null : target;
  return Boolean(element?.closest(WINDOW_DRAG_SUPPRESS_SELECTOR));
}

export function windowRectsMatch(actual: WindowRect, expected: WindowRect, tolerance = 4) {
  return (
    Math.abs(actual.x - expected.x) <= tolerance &&
    Math.abs(actual.y - expected.y) <= tolerance &&
    Math.abs(actual.width - expected.width) <= tolerance &&
    Math.abs(actual.height - expected.height) <= tolerance
  );
}

export function useDesktopWindowChrome() {
  const usesNativeWindowChrome = !isNativeMobileBuild;
  const [desktopPlatform, setDesktopPlatform] = useState<DesktopPlatform>("unknown");
  const customZoomRestoreBoundsRef = useRef<WindowBounds | null>(null);
  const customZoomAnimatingRef = useRef(false);
  const lastTitlebarPressRef = useRef(0);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (!hasTauriInternals()) {
      setDesktopPlatform("browser");
      return;
    }

    try {
      setDesktopPlatform(osPlatform() as DesktopPlatform);
    } catch {
      setDesktopPlatform("unknown");
    }
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const configureWindow = async () => {
      // Normalize the native view to the content bounds first. Tauri computes
      // auto-resize ratios from the current frame, so this ordering guarantees
      // a 1:1 main-webview resize instead of capturing a stale launch ratio.
      await enableModernWindowStyle(getCurrentWebviewWindow());
      if (disposed) return;
      await getCurrentWebview().setAutoResize(true);
    };
    void configureWindow().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

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

  const animateWindowRect = useCallback(
    async (from: WindowRect, to: WindowRect, durationMs = 500) => {
      if (!hasTauriInternals()) {
        return;
      }
      if (customZoomAnimatingRef.current) {
        return;
      }

      customZoomAnimatingRef.current = true;
      const window = getCurrentWindow();
      if (desktopPlatform === "windows") {
        try {
          await window.setPosition(new PhysicalPosition(to.x, to.y));
          await window.setSize(new PhysicalSize(to.width, to.height));
        } finally {
          customZoomAnimatingRef.current = false;
        }
        return;
      }

      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

      return new Promise<void>((resolve, reject) => {
        const start = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / durationMs);
          const eased = easeOutCubic(progress);
          const x = Math.round(from.x + (to.x - from.x) * eased);
          const y = Math.round(from.y + (to.y - from.y) * eased);
          const width = Math.round(from.width + (to.width - from.width) * eased);
          const height = Math.round(from.height + (to.height - from.height) * eased);

          // Keep only one native frame commit in flight. Fire-and-forget IPC
          // lets older size requests finish after newer ones, which makes the
          // window and WKWebView visibly jump and can miss the restore target.
          void Promise.all([
            window.setPosition(new PhysicalPosition(x, y)),
            window.setSize(new PhysicalSize(width, height)),
          ]).then(
            () => {
              if (progress < 1) {
                requestAnimationFrame(step);
                return;
              }
              customZoomAnimatingRef.current = false;
              if (desktopPlatform === "macos") {
                void repositionTrafficLights(getCurrentWebviewWindow()).catch(() => undefined);
              }
              resolve();
            },
            (error: unknown) => {
              customZoomAnimatingRef.current = false;
              if (desktopPlatform === "macos") {
                void repositionTrafficLights(getCurrentWebviewWindow()).catch(() => undefined);
              }
              reject(error);
            },
          );
        };

        requestAnimationFrame(step);
      });
    },
    [desktopPlatform],
  );

  const togglePseudoMaximize = useCallback(async () => {
    if (!hasTauriInternals()) return;
    if (customZoomAnimatingRef.current) return;
    const window = getCurrentWindow();
    if (await window.isFullscreen()) {
      return;
    }

    const [position, size, monitor] = await Promise.all([
      window.outerPosition(),
      window.outerSize(),
      currentMonitor().then((current) => current ?? primaryMonitor()),
    ]);

    const currentRect = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
    if (!monitor) return;
    const workAreaRect = {
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
    };
    const isActuallyZoomed = windowRectsMatch(currentRect, workAreaRect);

    if (!isActuallyZoomed) {
      // A manual resize, move, monitor change, or hot reload can invalidate an
      // in-memory zoom flag. The actual frame is authoritative: any window
      // that is not filling the current work area must expand from here.
      customZoomRestoreBoundsRef.current = { position, size };
      await animateWindowRect(currentRect, workAreaRect);
      setIsWindowMaximized(true);
      return;
    }

    const restoreBounds = customZoomRestoreBoundsRef.current;
    if (!restoreBounds) {
      setIsWindowMaximized(true);
      return;
    }

    await animateWindowRect(currentRect, {
      x: restoreBounds.position.x,
      y: restoreBounds.position.y,
      width: restoreBounds.size.width,
      height: restoreBounds.size.height,
    });
    setIsWindowMaximized(false);
  }, [animateWindowRect]);

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

  // Windows/Linux titlebar: drag on press, toggle maximize on a double-press.
  // We detect the double-press by timing rather than the DOM `dblclick`, which
  // the native drag loop (started on the first press) swallows. Uses the
  // pseudo-maximize because native toggleMaximize() is unreliable on this
  // borderless, transparent window.
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
        void togglePseudoMaximize().catch(() => undefined);
        return;
      }
      void getCurrentWindow()
        .startDragging()
        .catch(() => undefined);
    },
    [togglePseudoMaximize],
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

  const minimizeTitlebarWindow = useCallback(() => {
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .minimize()
      .catch(() => undefined);
  }, []);

  const closeTitlebarWindow = useCallback(() => {
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .close()
      .catch(() => undefined);
  }, []);

  const shouldShowWindowsTitlebarControls =
    usesNativeWindowChrome && (desktopPlatform === "windows" || desktopPlatform === "linux");

  return {
    usesNativeWindowChrome,
    desktopPlatform,
    shouldShowWindowsTitlebarControls,
    isWindowMaximized,
    startTitlebarDrag,
    handleDesktopTitlebarPointerDown,
    togglePseudoMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
  };
}

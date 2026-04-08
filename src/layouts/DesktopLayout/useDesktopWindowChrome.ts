import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { enableModernWindowStyle } from "@/stores/backend";
import { hasTauriInternals } from "@/platform/tauri";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import type { DesktopPlatform, WindowBounds, WindowRect } from "@/models/types/layouts";

export function useDesktopWindowChrome() {
  const usesNativeWindowChrome = !isNativeMobileBuild;
  const [desktopPlatform, setDesktopPlatform] = useState<DesktopPlatform>("unknown");
  const customZoomRestoreBoundsRef = useRef<WindowBounds | null>(null);
  const customZoomedRef = useRef(false);
  const customZoomAnimatingRef = useRef(false);

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
    void getCurrentWebview()
      .setAutoResize(true)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    void enableModernWindowStyle(getCurrentWebviewWindow()).catch(() => undefined);
  }, []);

  const startTitlebarDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button,a,input,textarea,select,[role='button']")) {
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

      return new Promise<void>((resolve) => {
        const start = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / durationMs);
          const eased = easeOutCubic(progress);
          const x = Math.round(from.x + (to.x - from.x) * eased);
          const y = Math.round(from.y + (to.y - from.y) * eased);
          const width = Math.round(from.width + (to.width - from.width) * eased);
          const height = Math.round(from.height + (to.height - from.height) * eased);

          void window.setPosition(new PhysicalPosition(x, y));
          void window.setSize(new PhysicalSize(width, height));

          if (progress < 1) {
            requestAnimationFrame(step);
            return;
          }

          customZoomAnimatingRef.current = false;
          resolve();
        };

        requestAnimationFrame(step);
      });
    },
    [desktopPlatform],
  );

  const togglePseudoMaximize = useCallback(async () => {
    if (!hasTauriInternals()) return;
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

    if (!customZoomedRef.current) {
      if (!monitor) {
        return;
      }

      customZoomRestoreBoundsRef.current = { position, size };
      await animateWindowRect(currentRect, {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      });
      customZoomedRef.current = true;
      return;
    }

    const restoreBounds = customZoomRestoreBoundsRef.current;
    if (!restoreBounds) {
      customZoomedRef.current = false;
      return;
    }

    await animateWindowRect(currentRect, {
      x: restoreBounds.position.x,
      y: restoreBounds.position.y,
      width: restoreBounds.size.width,
      height: restoreBounds.size.height,
    });
    customZoomedRef.current = false;
  }, [animateWindowRect]);

  const expandTitlebarWindow = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void togglePseudoMaximize().catch(() => undefined);
    },
    [togglePseudoMaximize],
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
    startTitlebarDrag,
    expandTitlebarWindow,
    togglePseudoMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
  };
}

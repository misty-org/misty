import type { DesktopPlatform, WindowBounds, WindowRect } from "@/app/layouts/desktop-state";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import { isSignedOutWindowLocked } from "./use_signed_out_window";
import { windowRectsMatch } from "./window_chrome_drag";

export function useTitlebarZoom(
  desktopPlatform: DesktopPlatform,
  setIsWindowMaximized: Dispatch<SetStateAction<boolean>>,
) {
  const customZoomRestoreBoundsRef = useRef<WindowBounds | null>(null);
  const customZoomAnimatingRef = useRef(false);
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
              resolve();
            },
            (error: unknown) => {
              customZoomAnimatingRef.current = false;
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
    if (!hasTauriInternals() || isSignedOutWindowLocked()) return;
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
      customZoomRestoreBoundsRef.current = {
        position,
        size,
      };
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
  }, [animateWindowRect, setIsWindowMaximized]);
  const toggleTitlebarMaximize = useCallback(async () => {
    if (!hasTauriInternals() || isSignedOutWindowLocked()) return;
    if (desktopPlatform === "windows" || desktopPlatform === "linux") {
      const window = getCurrentWindow();
      await window.toggleMaximize();
      setIsWindowMaximized(await window.isMaximized());
      return;
    }
    await togglePseudoMaximize();
  }, [desktopPlatform, togglePseudoMaximize, setIsWindowMaximized]);
  return { togglePseudoMaximize, toggleTitlebarMaximize };
}

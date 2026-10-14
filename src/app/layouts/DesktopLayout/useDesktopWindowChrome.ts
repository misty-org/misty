import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect } from "react";
import { useDesktopPlatform, useWindowStyleSetup } from "./useDesktopPlatformSetup";
import { useTitlebarPointerHandlers } from "./useTitlebarPointerHandlers";
import { useTitlebarZoom } from "./useTitlebarZoom";
import { useWindowMaximizedState } from "./useWindowMaximizedState";
import { useWindowsSnapLayouts } from "./useWindowsSnapLayouts";

export { shouldSuppressWindowDrag, windowRectsMatch } from "./windowChromeHelpers";

export function useDesktopWindowChrome() {
  const desktopPlatform = useDesktopPlatform();
  useWindowStyleSetup();
  const [isWindowMaximized, setIsWindowMaximized] = useWindowMaximizedState();
  const { togglePseudoMaximize, toggleTitlebarMaximize } = useTitlebarZoom(
    desktopPlatform,
    setIsWindowMaximized,
  );
  const { startTitlebarDrag, handleDesktopTitlebarPointerDown, handleTopEdgePointerDown } =
    useTitlebarPointerHandlers(desktopPlatform, togglePseudoMaximize, toggleTitlebarMaximize);
  // A double press on a page's top edge, which the native page reports, is the titlebar's
  // double-click: zoom or restore the window the same way.
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("misty://browser-titlebar-zoom", () => {
      void (desktopPlatform === "macos" ? togglePseudoMaximize() : toggleTitlebarMaximize()).catch(
        () => undefined,
      );
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktopPlatform, togglePseudoMaximize, toggleTitlebarMaximize]);
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
    desktopPlatform === "windows" || desktopPlatform === "linux";
  const { showSnapLayoutsSoon, cancelSnapLayouts } = useWindowsSnapLayouts(desktopPlatform);

  return {
    desktopPlatform,
    shouldShowWindowsTitlebarControls,
    isWindowMaximized,
    startTitlebarDrag,
    handleDesktopTitlebarPointerDown,
    handleTopEdgePointerDown,
    toggleTitlebarMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
    showSnapLayoutsSoon,
    cancelSnapLayouts,
  };
}

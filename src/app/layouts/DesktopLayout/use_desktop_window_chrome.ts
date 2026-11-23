import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect } from "react";
import { useDesktopPlatform, useWindowStyleSetup } from "./use_desktop_platform_setup";
import { useTitlebarPointerHandlers } from "./use_titlebar_pointer_handlers";
import { useTitlebarZoom } from "./use_titlebar_zoom";
import { useWindowMaximizedState } from "./use_window_maximized_state";
import { useWindowsSnapLayouts } from "./use_windows_snap_layouts";

export { shouldSuppressWindowDrag, windowRectsMatch } from "./window_chrome_drag";

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
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("misty://browser-titlebar-zoom", () => {
      void (desktopPlatform === "macos" ? togglePseudoMaximize() : toggleTitlebarMaximize()).catch(
        () => undefined,
      );
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
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

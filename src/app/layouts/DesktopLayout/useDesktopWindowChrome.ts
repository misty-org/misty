import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";
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
  const { startTitlebarDrag, handleDesktopTitlebarPointerDown } = useTitlebarPointerHandlers(
    desktopPlatform,
    togglePseudoMaximize,
    toggleTitlebarMaximize,
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
    desktopPlatform === "windows" || desktopPlatform === "linux";
  const { showSnapLayoutsSoon, cancelSnapLayouts } = useWindowsSnapLayouts(desktopPlatform);

  return {
    desktopPlatform,
    shouldShowWindowsTitlebarControls,
    isWindowMaximized,
    startTitlebarDrag,
    handleDesktopTitlebarPointerDown,
    toggleTitlebarMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
    showSnapLayoutsSoon,
    cancelSnapLayouts,
  };
}

import { extensionThemeChangedEvent, extensionThemeSnapshot } from "@/features/settings";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealMainWindow } from "@/native";
import { appZoomChangedEvent, getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { platform } from "@tauri-apps/plugin-os";
import { useEffect } from "react";
import { windowSurfaceBackground } from "./windowSurfaceBackground";

/** Prepare native chrome and saved zoom once, independently of the active route.
 * macOS starts hidden and reveals after native traffic-light layout completes.
 */
export function DesktopWindowReady() {
  useEffect(() => {
    if (isNativeMobileBuild || !hasTauriInternals() || platform() !== "macos") return;
    let disposed = false;
    // Color the NSWindow behind the renderer without making the renderer
    // opaque: embedded Browser views and native wallpaper need transparency.
    let lastBackground = "";
    let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
    const syncBackground = async () => {
      const color = windowSurfaceBackground(extensionThemeSnapshot().tokens.background);
      if (disposed || color === lastBackground) return;
      await getCurrentWindow().setBackgroundColor(color);
      lastBackground = color;
    };
    // DOM changes can be frequent (chat streams, animations). Sample only once
    // they settle, never measure layout or send native IPC per resize frame.
    const scheduleBackground = () => {
      clearTimeout(backgroundTimer);
      backgroundTimer = setTimeout(() => {
        void syncBackground().catch(console.error);
      }, 120);
    };
    const backgroundObserver = new MutationObserver(scheduleBackground);
    backgroundObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-state", "data-misty-browser-background"],
    });
    window.addEventListener(extensionThemeChangedEvent, scheduleBackground);
    window.addEventListener("resize", scheduleBackground);
    const prepare = async () => {
      await syncBackground();
      await document.fonts.ready;
      // Child webview bounds use this same physical render scale, including
      // the product baseline (displayed 100% currently renders at 1.1x).
      await getCurrentWebview().setZoom(getAppliedAppRenderScale());
      if (!disposed) window.dispatchEvent(new Event(appZoomChangedEvent));
      // A hidden WKWebView may not deliver animation frames. Let the committed
      // React tree finish layout without depending on requestAnimationFrame.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!disposed) await revealMainWindow();
    };
    void prepare().catch((error) => {
      console.error("Unable to prepare the main window", error);
      // A font/zoom failure must not strand the user in an invisible app.
      // The native reveal still positions the controls before showing it.
      if (!disposed) void revealMainWindow().catch(console.error);
    });
    return () => {
      disposed = true;
      clearTimeout(backgroundTimer);
      backgroundObserver.disconnect();
      window.removeEventListener(extensionThemeChangedEvent, scheduleBackground);
      window.removeEventListener("resize", scheduleBackground);
    };
  }, []);
  return null;
}

import { appThemeChangedEvent, appThemeSnapshot } from "@/features/settings";
import { revealMainWindow, setWindowSurface } from "@/native";
import { appZoomChangedEvent, getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { platform } from "@/shared/platform/os";
import { useEffect } from "react";

/** Prepare native chrome and saved zoom once, independently of the active route.
 * The window starts hidden and reveals once its background matches the theme
 * (on macOS, also after native traffic-light layout completes).
 */
export function NativeWindowSetup() {
  useEffect(() => {
    // Modals keep clear of the macOS traffic lights, which float above every web layer.
    if (hasTauriInternals() && platform() === "macos")
      document.documentElement.style.setProperty("--misty-modal-inset-top", "2.75rem");
    if (!hasTauriInternals() || !["macos", "windows", "linux"].includes(platform())) return;
    let disposed = false;
    // Every page sits on the theme's background, so the window behind them is that color too:
    // it shows at the grown edge while a resize catches up. It changes only with the theme.
    let lastSurface = "";
    const syncSurface = async () => {
      const color = appThemeSnapshot().tokens.background;
      if (disposed || color === lastSurface) return;
      await setWindowSurface(color);
      lastSurface = color;
    };
    const themeChanged = () => void syncSurface().catch(console.error);
    window.addEventListener(appThemeChangedEvent, themeChanged);
    const prepare = async () => {
      await syncSurface();
      // `fonts.ready` alone can settle before Inter has even started loading (a face loads
      // once text first asks for it), and the text then reflows from the fallback face right
      // after the window shows. Ask for Inter by name so the first frame is already in it.
      await document.fonts.load?.('1em "Inter Variable"').catch(() => undefined);
      await document.fonts.ready;
      // Child webview bounds use this same physical render scale (displayed
      // 100% renders at 1, and the root font size stays at 100% too).
      await getCurrentWebview().setZoom(getAppliedAppRenderScale());
      if (!disposed) window.dispatchEvent(new Event(appZoomChangedEvent));
      // A hidden webview may not deliver animation frames. Let the committed
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
      window.removeEventListener(appThemeChangedEvent, themeChanged);
    };
  }, []);
  return null;
}

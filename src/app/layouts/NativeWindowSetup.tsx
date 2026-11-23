import { appThemeChangedEvent, appThemeSnapshot } from "@/features/settings";
import { revealMainWindow, setWindowSurface } from "@/native";
import { appZoomChangedEvent, getAppliedAppRenderScale } from "@/shared/hooks/use_app_zoom";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { platform } from "@/shared/platform/os";
import { useEffect } from "react";

export function NativeWindowSetup() {
  useEffect(() => {
    if (hasTauriInternals() && platform() === "macos")
      document.documentElement.style.setProperty("--misty-modal-inset-top", "2.75rem");
    if (!hasTauriInternals() || !["macos", "windows", "linux"].includes(platform())) return;
    let disposed = false;
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
      await document.fonts.load?.('1em "Inter Variable"').catch(() => undefined);
      await document.fonts.ready;
      await getCurrentWebview().setZoom(getAppliedAppRenderScale());
      if (!disposed) window.dispatchEvent(new Event(appZoomChangedEvent));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!disposed) await revealMainWindow();
    };
    void prepare().catch((error) => {
      console.error("Unable to prepare the main window", error);
      if (!disposed) void revealMainWindow().catch(console.error);
    });
    return () => {
      disposed = true;
      window.removeEventListener(appThemeChangedEvent, themeChanged);
    };
  }, []);
  return null;
}

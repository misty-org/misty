import { revealMainWindow } from "@/native";
import { getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { platform } from "@tauri-apps/plugin-os";
import { useEffect } from "react";

/** Prepare native chrome and saved zoom once, independently of the active route.
 * The native window is already visible so loading failures cannot hide the app.
 */
export function DesktopWindowReady() {
  useEffect(() => {
    if (isNativeMobileBuild || !hasTauriInternals() || platform() !== "macos") return;
    let disposed = false;
    const prepare = async () => {
      await document.fonts.ready;
      await getCurrentWebview().setZoom(getAppliedAppZoom());
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
    };
  }, []);
  return null;
}

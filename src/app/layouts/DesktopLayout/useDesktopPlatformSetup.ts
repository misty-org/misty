import type { DesktopPlatform } from "@/app/layouts/model";
import { enableModernWindowStyle } from "@/native";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";

export function useDesktopPlatform() {
  const [desktopPlatform, setDesktopPlatform] = useState<DesktopPlatform>("unknown");
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
  return desktopPlatform;
}

export function useWindowStyleSetup() {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const configureWindow = async () => {
      await enableModernWindowStyle(getCurrentWindow());
      if (disposed) return;
      // macOS uses native AppKit autoresizing, configured by the command.
      // Enabling Tauri's proportional sizing here adds delayed frame writes.
      if (osPlatform() !== "macos") await getCurrentWebview().setAutoResize(true);
    };
    void configureWindow().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);
}

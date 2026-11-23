import type { DesktopPlatform } from "@/app/layouts/desktop-state";
import {
  enableModernWindowStyle,
  sideTabTrafficLightNudgeX,
  trafficLightOffsetDefault,
  trafficLightRestY,
} from "@/native";
import { useWindowDockingLayout } from "@/features/app-windows";
import { dockingMetrics } from "./docking_geometry";
import { uiPx } from "@misty/ui";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform as osPlatform } from "@/shared/platform/os";
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
  const { tabs } = useWindowDockingLayout();
  const { edge, sideTabInset, spaceBar } = dockingMetrics;
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const configureWindow = async () => {
      const shell = document.querySelector<HTMLElement>(".misty-docking-frame");
      const drawerButton =
        tabs === "left"
          ? shell?.querySelector<HTMLElement>(
              '.misty-workspace-tabs[data-tab-position="left"] .misty-sidebar-head button',
            )
          : null;
      const shellBounds = shell?.getBoundingClientRect();
      const scale = shell?.offsetHeight
        ? (shellBounds?.height ?? shell.offsetHeight) / shell.offsetHeight
        : 1;
      const drawerButtonBounds = drawerButton?.getBoundingClientRect();
      const drawerButtonCenter =
        shellBounds && drawerButtonBounds
          ? (drawerButtonBounds.top + drawerButtonBounds.height / 2 - shellBounds.top) / scale
          : null;
      const verticalDrawerOffset =
        drawerButtonCenter !== null ? drawerButtonCenter - trafficLightRestY : sideTabInset;
      const verticalOffset =
        tabs === "left" ? verticalDrawerOffset : uiPx(edge + spaceBar / 2) - trafficLightRestY;
      await enableModernWindowStyle(getCurrentWindow(), {
        x: trafficLightOffsetDefault.x + (tabs === "left" ? sideTabTrafficLightNudgeX : 0),
        y: trafficLightOffsetDefault.y + verticalOffset,
      });
      if (disposed) return;
      if (osPlatform() !== "macos") await getCurrentWebview().setAutoResize(true);
    };
    void configureWindow().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [edge, sideTabInset, spaceBar, tabs]);
}

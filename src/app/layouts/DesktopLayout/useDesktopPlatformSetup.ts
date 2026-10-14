import type { DesktopPlatform } from "@/app/layouts/model";
import {
  enableModernWindowStyle,
  sideTabTrafficLightNudgeX,
  trafficLightOffsetDefault,
  trafficLightRestY,
} from "@/native";
import { useWindowDockingLayout } from "@/features/workspace";
import { dockingMetrics } from "./dockingGeometry";
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
  const { tabs } = useWindowDockingLayout();
  // Horizontal tabs center the buttons on the full strip. Vertical tabs align to the drawer button.
  const { tabStrip, titlebar, sideTabInset } = dockingMetrics;
  const drop = tabs === "top" ? tabStrip / 2 - titlebar / 2 : 0;
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
      const verticalDrawerOffset = drawerButtonCenter !== null
        ? drawerButtonCenter - trafficLightRestY
        : sideTabInset;
      const verticalOffset = tabs === "left" ? verticalDrawerOffset : drop;
      await enableModernWindowStyle(getCurrentWindow(), {
        x:
          trafficLightOffsetDefault.x +
          (tabs === "left" ? sideTabTrafficLightNudgeX : 0),
        y: trafficLightOffsetDefault.y + verticalOffset,
      });
      if (disposed) return;
      // macOS uses native AppKit autoresizing, configured by the command.
      // Enabling Tauri's proportional sizing here adds delayed frame writes.
      if (osPlatform() !== "macos") await getCurrentWebview().setAutoResize(true);
    };
    void configureWindow().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [drop, sideTabInset, tabs]);
}

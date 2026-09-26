import type { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { Folder } from "lucide-react";

export type DesktopNavItem = {
  id: string;
  label: string;
  path: string;
  icon: typeof Folder;
  exact?: boolean;
  active?: (pathname: string) => boolean;
};

export type WindowBounds = {
  position: PhysicalPosition;
  size: PhysicalSize;
};

export type WindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopPlatform = "macos" | "windows" | "linux" | "browser" | "unknown";

export type AppNoticeSource = "app" | "providers" | "settings";

export type AppNoticeKind = "error" | "message";

export type AppNoticeEntry = readonly [AppNoticeSource, AppNoticeKind, string | null];

export type FramePacingState = {
  fps: number;
  frameMs: number;
  slowFramePercent: number;
  level: "idle" | "light" | "heavy";
};

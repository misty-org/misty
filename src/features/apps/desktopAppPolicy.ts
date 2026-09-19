import type { OfficialApp } from "@/api/apps";

/** Global navigation shortcuts do not make these installed apps built-in surfaces. */
export function requiresDownloadedDesktopApp(appId: string): boolean {
  return appId === "files" || appId === "browser";
}

export function hasInvalidDesktopAppRuntime(app: OfficialApp): boolean {
  return requiresDownloadedDesktopApp(app.id) && app.desktop.runtime !== "downloaded";
}

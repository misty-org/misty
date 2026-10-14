import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { hasTauriInternals } from "./tauri";

export type DesktopOs = "macos" | "windows" | "linux";

/** The operating system Misty runs on: the native answer in the app, the browser's guess elsewhere. */
export function desktopOs(): DesktopOs {
  if (hasTauriInternals()) {
    try {
      const value = osPlatform();
      if (value === "macos" || value === "windows" || value === "linux") return value;
    } catch {
      // The browser fallback below keeps tests and web previews usable.
    }
  }
  const hint = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
  if (/mac/i.test(hint)) return "macos";
  if (/win/i.test(hint)) return "windows";
  return "linux";
}

/** Where the person turns microphone access back on for Misty. */
export function microphoneSettingsHint(): string {
  return desktopOs() === "windows"
    ? "Allow it for Misty in Windows Settings › Privacy & security › Microphone, then try again."
    : "Allow it for Misty in System Settings, then try again.";
}

/** The name of the system's file manager, for "Show in …" actions. */
export function fileManagerName(): string {
  switch (desktopOs()) {
    case "macos":
      return "Finder";
    case "windows":
      return "File Explorer";
    default:
      return "Files";
  }
}

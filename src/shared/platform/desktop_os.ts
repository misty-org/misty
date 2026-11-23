import { platform as osPlatform } from "@/shared/platform/os";
import { hasTauriInternals } from "./tauri";

type DesktopOs = "macos" | "windows" | "linux";

export function desktopOs(): DesktopOs {
  if (hasTauriInternals()) {
    try {
      const value = osPlatform();
      if (value === "macos" || value === "windows" || value === "linux") return value;
    } catch {}
  }
  const hint = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
  if (/mac/i.test(hint)) return "macos";
  if (/win/i.test(hint)) return "windows";
  return "linux";
}

export function microphoneSettingsHint(): string {
  return desktopOs() === "windows"
    ? "Allow it for Misty in Windows Settings › Privacy & security › Microphone, then try again."
    : "Allow it for Misty in System Settings, then try again.";
}

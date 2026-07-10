import { platform } from "@tauri-apps/plugin-os";
import { useSyncExternalStore } from "react";
import { hasTauriInternals } from "../shared/tauri";
import { isAndroidBuild } from "./buildTarget";

export type AppFormFactor = "desktop" | "mobile";

const mobilePlatforms = new Set(["ios", "android"]);
const mobilePreviewQuery = "(max-width: 720px)";
// Android WebView reports viewport sizes in density-independent CSS pixels. A
// 600dp shortest edge is Android's conventional tablet breakpoint, so phones
// stay in the touch layout even when rotated while tablets and ChromeOS use
// Misty's desktop component tree.
const desktopAndroidWindowQuery = "(min-width: 600px) and (min-height: 600px)";

function forcedFormFactor(): AppFormFactor | null {
  const value = import.meta.env.VITE_MISTY_FORCE_FORM_FACTOR?.trim().toLowerCase();
  return value === "desktop" || value === "mobile" ? value : null;
}

export function detectAppFormFactor(): AppFormFactor {
  const forced = forcedFormFactor();
  if (forced) return forced;

  try {
    if (hasTauriInternals() && mobilePlatforms.has(platform())) {
      if (isAndroidBuild && window.matchMedia(desktopAndroidWindowQuery).matches) return "desktop";
      return "mobile";
    }
  } catch {}

  if (typeof window !== "undefined" && window.matchMedia(mobilePreviewQuery).matches) {
    return "mobile";
  }

  return "desktop";
}

export function subscribeAppFormFactor(callback: (formFactor: AppFormFactor) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const media = window.matchMedia(mobilePreviewQuery);
  const desktopAndroidMedia = window.matchMedia(desktopAndroidWindowQuery);
  const listener = () => callback(detectAppFormFactor());
  media.addEventListener("change", listener);
  desktopAndroidMedia.addEventListener("change", listener);
  return () => {
    media.removeEventListener("change", listener);
    desktopAndroidMedia.removeEventListener("change", listener);
  };
}

export function useAppFormFactor(): AppFormFactor {
  return useSyncExternalStore(
    subscribeAppFormFactor,
    detectAppFormFactor,
    detectAppFormFactor,
  );
}

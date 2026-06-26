import { platform } from "@tauri-apps/plugin-os";

export type AppFormFactor = "desktop" | "mobile";

const mobilePlatforms = new Set(["ios", "android"]);
const mobilePreviewQuery = "(max-width: 720px)";

export function detectAppFormFactor(): AppFormFactor {
  try {
    if (mobilePlatforms.has(platform())) return "mobile";
  } catch {
    // Browser smoke mode runs without Tauri plugin internals.
  }

  if (typeof window !== "undefined" && window.matchMedia(mobilePreviewQuery).matches) {
    return "mobile";
  }

  return "desktop";
}

export function subscribeAppFormFactor(callback: (formFactor: AppFormFactor) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const media = window.matchMedia(mobilePreviewQuery);
  const listener = () => callback(detectAppFormFactor());
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

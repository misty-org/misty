import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { selectGeneralPreferences, useSettingsStore } from "@/stores/app";
import type { MouseEvent } from "react";
import { hasTauriInternals } from "@/platform/tauri";

export interface ProviderAuthorizationOpenResult {
  strategy: "in-app-browser" | "system-browser" | "window-open";
  platform: string;
  attemptedAt: number;
  fallbackReason?: string;
}

import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import { hasTauriInternals } from "@/platform/tauri";

export type AuthDeepLinkTarget = "account" | "providers";

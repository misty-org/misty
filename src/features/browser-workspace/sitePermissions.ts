import { hasTauriInternals } from "@/shared/platform/tauri";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";

export type SitePermissionDecision = "ask" | "allow" | "block";
export interface SitePermissions {
  camera: SitePermissionDecision;
  microphone: SitePermissionDecision;
}
export interface BrowserSiteInfo {
  url: string;
  origin: string;
  secure: boolean;
  persistent: boolean;
  permissions: SitePermissions;
}
export interface SavedSitePermission {
  profile: string;
  origin: string;
  permissions: SitePermissions;
}
export function supportsSitePermissions() {
  return (
    hasTauriInternals() &&
    !isNativeMobileBuild &&
    ((window as Window & { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string } })
      .__TAURI_OS_PLUGIN_INTERNALS__?.platform === "macos" ||
      /Mac/i.test(navigator.platform))
  );
}
export const permissionLabels: Record<SitePermissionDecision, string> = {
  ask: "Ask",
  allow: "Allow",
  block: "Block",
};

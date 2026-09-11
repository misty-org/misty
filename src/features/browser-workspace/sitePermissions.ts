import { desktopOs } from "@/shared/platform/desktopOs";
import { hasTauriInternals } from "@/shared/platform/tauri";
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
/** Kiri decides camera and microphone requests on macOS (WebKit) and Windows (WebView2). */
export function supportsSitePermissions() {
  return hasTauriInternals() && ["macos", "windows"].includes(desktopOs());
}
export const permissionLabels: Record<SitePermissionDecision, string> = {
  ask: "Ask",
  allow: "Allow",
  block: "Block",
};

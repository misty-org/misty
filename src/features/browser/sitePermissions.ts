import { desktopOs } from "@/shared/platform/desktopOs";
import { hasTauriInternals } from "@/shared/platform/tauri";
export type SitePermissionDecision = "ask" | "allow" | "block";
export interface SitePermissions {
  camera: SitePermissionDecision;
  microphone: SitePermissionDecision;
  location: SitePermissionDecision;
}
export type SitePermissionKind = keyof SitePermissions;
/** The site permissions Misty decides, in the order surfaces list them. */
export const sitePermissionKinds: { kind: SitePermissionKind; label: string }[] = [
  { kind: "camera", label: "Camera" },
  { kind: "microphone", label: "Microphone" },
  { kind: "location", label: "Location" },
];
export interface SavedSitePermission {
  /** The website data store holding the choice; native code names it. */
  profile: string;
  origin: string;
  permissions: SitePermissions;
  /** The profile whose store it is. */
  profileName: string;
}
/** Kiri decides camera, microphone and location requests on macOS (WebKit) and Windows (WebView2). */
export function supportsSitePermissions() {
  return hasTauriInternals() && ["macos", "windows"].includes(desktopOs());
}
export const permissionLabels: Record<SitePermissionDecision, string> = {
  ask: "Ask",
  allow: "Allow",
  block: "Block",
};

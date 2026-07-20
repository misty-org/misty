import { runtimeAssetReference } from "@/platform/runtimeAsset";

export const iconAssets = {
  activityCheck: runtimeAssetReference("icons/activity-check-svgrepo.svg"),
  cloud24: runtimeAssetReference("icons/cloud-24.svg"),
  dropboxColor: runtimeAssetReference("icons/dropbox-color.svg"),
  eye16: runtimeAssetReference("icons/eye-16.svg"),
  eyeClosed16: runtimeAssetReference("icons/eye-closed-16.svg"),
  fileDirectoryFill16: runtimeAssetReference("icons/file-directory-fill-16.svg"),
  fileDirectoryOpenFill24: runtimeAssetReference("icons/file-directory-open-fill-24.svg"),
  gear24: runtimeAssetReference("icons/gear-24.svg"),
  googleDriveColor: runtimeAssetReference("icons/google-drive-color.svg"),
  kebabHorizontal24: runtimeAssetReference("icons/kebab-horizontal-24.svg"),
  onedriveColor: runtimeAssetReference("icons/onedrive-color.svg"),
  plus16: runtimeAssetReference("icons/plus-16.svg"),
  shieldLock24: runtimeAssetReference("icons/shield-lock-24.svg"),
  sync16: runtimeAssetReference("icons/sync-16.svg"),
  sync24: runtimeAssetReference("icons/sync-24.svg"),
  trash24: runtimeAssetReference("icons/trash-24.svg"),
  verified24: runtimeAssetReference("icons/verified-24.svg"),
  x24: runtimeAssetReference("icons/x-24.svg"),
  xCircleFill16: runtimeAssetReference("icons/x-circle-fill-16.svg"),
} as const;

export function providerIconForType(type: string): { src: string; color: boolean } {
  const normalized = type.toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized.includes("googledrive") || normalized === "drive") {
    return { src: iconAssets.googleDriveColor, color: true };
  }
  if (normalized.includes("onedrive")) {
    return { src: iconAssets.onedriveColor, color: true };
  }
  if (normalized.includes("dropbox")) {
    return { src: iconAssets.dropboxColor, color: true };
  }
  return { src: iconAssets.cloud24, color: false };
}

import activityCheck from "../../../assets/icons/activity-check-svgrepo.svg?url";
import cloud24 from "../../../assets/icons/cloud-24.svg?url";
import dropboxColor from "../../../assets/icons/dropbox-color.svg?url";
import eye16 from "../../../assets/icons/eye-16.svg?url";
import eyeClosed16 from "../../../assets/icons/eye-closed-16.svg?url";
import fileDirectoryFill16 from "../../../assets/icons/file-directory-fill-16.svg?url";
import fileDirectoryOpenFill24 from "../../../assets/icons/file-directory-open-fill-24.svg?url";
import gear24 from "../../../assets/icons/gear-24.svg?url";
import googleDriveColor from "../../../assets/icons/google-drive-color.svg?url";
import kebabHorizontal24 from "../../../assets/icons/kebab-horizontal-24.svg?url";
import onedriveColor from "../../../assets/icons/onedrive-color.svg?url";
import plus16 from "../../../assets/icons/plus-16.svg?url";
import shieldLock24 from "../../../assets/icons/shield-lock-24.svg?url";
import sync16 from "../../../assets/icons/sync-16.svg?url";
import sync24 from "../../../assets/icons/sync-24.svg?url";
import trash24 from "../../../assets/icons/trash-24.svg?url";
import verified24 from "../../../assets/icons/verified-24.svg?url";
import x24 from "../../../assets/icons/x-24.svg?url";
import xCircleFill16 from "../../../assets/icons/x-circle-fill-16.svg?url";

export const iconAssets = {
  activityCheck,
  cloud24,
  dropboxColor,
  eye16,
  eyeClosed16,
  fileDirectoryFill16,
  fileDirectoryOpenFill24,
  gear24,
  googleDriveColor,
  kebabHorizontal24,
  onedriveColor,
  plus16,
  shieldLock24,
  sync16,
  sync24,
  trash24,
  verified24,
  x24,
  xCircleFill16,
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

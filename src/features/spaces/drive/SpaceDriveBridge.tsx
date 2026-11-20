import { useEffect } from "react";
import { startDriveNotices } from "./driveNotices";
import { startDriveSpacesSync } from "./driveSpacesSync";

/**
 * The Space drive's window-wide listeners: which Spaces this computer mounts (kept in step with the
 * signed-in account and its Spaces for as long as the window lives), and the drive's notices while
 * the shell shows. It draws nothing.
 */
export function SpaceDriveBridge() {
  useEffect(() => {
    startDriveSpacesSync();
    return startDriveNotices();
  }, []);
  return null;
}

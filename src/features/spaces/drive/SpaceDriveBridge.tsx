import { useEffect } from "react";
import { startDriveNotices } from "./drive_notices";
import { startDriveSpacesSync } from "./drive_spaces_sync";

export function SpaceDriveBridge() {
  useEffect(() => {
    startDriveSpacesSync();
    return startDriveNotices();
  }, []);
  return null;
}

import { notify } from "@misty/ui";
import { useSpacesStore } from "../list/use_spaces_store";
import { spaceNavigationName } from "../routes/default_space";
import {
  driveNative,
  onDriveNotice,
  onDriveStatus,
  type DriveNotice,
  type DriveSpaceStatus,
} from "./drive_native";

const failed = (message: string) => () => notify({ message, tone: "error" });

export function driveNoticeOptions(notice: DriveNotice): Parameters<typeof notify>[0] | null {
  const { name, space_id: spaceId } = notice;
  const by = notice.by?.trim() || "Someone";
  switch (notice.kind) {
    case "deleted_while_open": {
      const itemId = notice.item_id;
      return {
        message: `${by} deleted ${name}`,
        action: itemId
          ? {
              label: "Restore",
              onSelect: () =>
                void driveNative
                  .restore(spaceId, itemId)
                  .catch(failed(`${name} couldn't be restored. Try again.`)),
            }
          : undefined,
      };
    }
    case "delete_refused_in_use":
      return { message: `${by} has ${name} open` };
    case "save_replaced":
      return {
        message: `${by} saved ${name} after you, so yours is kept beside it as a conflicted copy`,
      };
    case "revived":
      return { message: `${by} put ${name} back from .trash` };
    case "deletes_held": {
      const burst = notice.burst;
      const count = notice.count ?? 0;
      const files = count === 1 ? "1 file was" : `${count} files were`;
      if (count === 0)
        return { message: `That would delete too much of ${name}, so Misty kept it` };
      return {
        message: `${files} deleted from ${name} at once, so Misty kept the rest`,
        action: burst
          ? {
              label: "Undo",
              onSelect: () =>
                void driveNative
                  .restoreBurst(spaceId, burst)
                  .catch(failed(`The deleted files in ${name} couldn't be put back. Try again.`)),
            }
          : undefined,
      };
    }
    default:
      return null;
  }
}

const announcedFailures = new Map<string, string>();

export function forgetDriveFailures() {
  announcedFailures.clear();
}

export function announceDriveStatus(
  next: DriveSpaceStatus | DriveSpaceStatus[],
  retry?: () => void,
) {
  for (const status of Array.isArray(next) ? next : [next]) {
    if (status.status !== "failed") {
      announcedFailures.delete(status.space_id);
      continue;
    }
    const why = status.message?.trim() ?? "";
    if (announcedFailures.get(status.space_id) === why) continue;
    announcedFailures.set(status.space_id, why);
    const space = useSpacesStore.getState().spaces.find((shown) => shown.id === status.space_id);
    const name = space ? spaceNavigationName(space) : "A Space";
    notify({
      id: `drive-failed:${status.space_id}`,
      tone: "error",
      message: why ? `${name} couldn't sync: ${why}` : `${name} couldn't sync`,
      action: retry ? { label: "Try again", onSelect: retry } : undefined,
    });
  }
}

let stop: (() => void) | null = null;

export function startDriveNotices(): () => void {
  if (!stop) {
    const stopNotices = onDriveNotice((notice) => {
      const options = driveNoticeOptions(notice);
      if (options)
        notify({ ...options, id: `drive:${notice.kind}:${notice.space_id}:${notice.name}` });
    });
    const stopStatus = onDriveStatus((status) => announceDriveStatus(status));
    stop = () => {
      stopNotices();
      stopStatus();
    };
  }
  return () => {
    stop?.();
    stop = null;
  };
}

import { notify } from "@misty/ui";
import { driveNative, onDriveNotice, type DriveNotice } from "./drive_native";

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

let stop: (() => void) | null = null;

export function startDriveNotices(): () => void {
  if (!stop)
    stop = onDriveNotice((notice) => {
      const options = driveNoticeOptions(notice);
      if (options)
        notify({ ...options, id: `drive:${notice.kind}:${notice.space_id}:${notice.name}` });
    });
  return () => {
    stop?.();
    stop = null;
  };
}

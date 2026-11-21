import { notify } from "@misty/ui";
import { driveNative, onDriveNotice, type DriveNotice } from "./driveNative";

const failed = (message: string) => () => notify({ message, tone: "error" });

/** What the person is told about a drive notice, with its one action when it has one. */
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
    case "save_replaced": {
      const itemId = notice.item_id;
      return {
        message: `${by}'s save replaced yours on ${name}`,
        action: itemId
          ? {
              label: "Restore",
              onSelect: () =>
                void driveNative
                  .restore(spaceId, itemId)
                  .catch(failed(`Your save of ${name} couldn't be restored. Try again.`)),
            }
          : undefined,
      };
    }
    case "revived":
      return { message: `${by}'s edit brought ${name} back` };
    case "deletes_held": {
      const burst = notice.burst;
      const count = notice.count ?? 0;
      const files = count === 1 ? "1 file was" : `${count} files were`;
      // Nothing went before the stop (one big folder): say what was kept.
      if (count === 0) return { message: `That would delete too much of ${name}, so Misty kept it` };
      return {
        message: `${files} deleted from ${name} at once, so Misty kept the rest`,
        action:
          burst
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

/**
 * Shows the drive's notices (`misty://drive-notice`) as Misty's own notices, each with at most one
 * action: Restore for a file deleted while open, and for a save someone else's save replaced (its
 * copy waits in the trash); Undo for a run of deletes the delete guard stopped.
 * Started once for the window; calling it again does nothing. Returns the function that stops it.
 */
export function startDriveNotices(): () => void {
  if (!stop)
    stop = onDriveNotice((notice) => {
      const options = driveNoticeOptions(notice);
      // One notice per file and kind: a repeat replaces the one still up.
      if (options)
        notify({ ...options, id: `drive:${notice.kind}:${notice.space_id}:${notice.name}` });
    });
  return () => {
    stop?.();
    stop = null;
  };
}

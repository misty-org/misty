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
    default:
      return null;
  }
}

let stop: (() => void) | null = null;

/**
 * Shows the drive's notices (`misty://drive-notice`) as Misty's own notices, each with at most one
 * action: Restore for a file deleted while open, and for a save someone else's save replaced (its
 * copy waits in the trash).
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

import { filesApi } from "@/features/agents";
import { disk } from "@/features/files";
import { driveNative } from "../drive";
import {
  agentTrashItem,
  diskItem,
  driveItem,
  driveTrashItem,
  finderOrder,
  projectItem,
  trashedItem,
  type FileItem,
  type FilesPlace,
} from "./model";

/** How many entries of a drive folder one read takes, for the columns. */
const DRIVE_PAGE = 200;

/**
 * Reads what a place holds, once: a folder (on the disk, in a project or a Space's drive) or one of the
 * sidebar's lists. `hidden` shows the names Finder hides. The current drive folder is followed live by
 * `useDriveList` instead; this is for the columns and everything else.
 */
export async function listPlace(place: FilesPlace, hidden: boolean): Promise<FileItem[]> {
  const shown = (items: FileItem[]) => (hidden ? items : items.filter((item) => !item.hidden));
  switch (place.kind) {
    case "disk": {
      const listing = await disk.list(place.path, hidden);
      return shown(listing.entries.map(diskItem));
    }
    case "project": {
      const entries = await filesApi.listDir(place.path);
      return shown(entries.map((entry) => projectItem(place.path, entry))).sort(finderOrder);
    }
    case "space-drive": {
      const page = await driveNative.list(place.spaceId, place.path, { limit: DRIVE_PAGE });
      return shown(page.entries.map(driveItem)).sort(finderOrder);
    }
    case "space-drive-trash":
      return (await driveNative.trashList(place.spaceId)).map(driveTrashItem);
    case "recent":
      return (await disk.recent()).map(diskItem);
    case "starred":
      return (await disk.starred()).map(diskItem);
    case "tag":
      return (await disk.tagged(place.name)).map(diskItem);
    case "trash":
      return (await disk.trashed()).map(trashedItem);
    case "agent-trash":
      return (await disk.agentTrash()).map(agentTrashItem);
  }
}

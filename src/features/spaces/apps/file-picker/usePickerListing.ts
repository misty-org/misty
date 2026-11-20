import { notify } from "@misty/ui";
import { useEffect, useState } from "react";
import { filesApi } from "@/features/agents";
import { mimeFromName } from "../../drive/driveEntries";
import {
  driveNative,
  driveParent,
  drivePath,
  onDriveChanged,
  type DriveEntry,
} from "../../drive/driveNative";
import { acceptsFile } from "../spaceAppFiles";
import { childPath, placeKey, type PickerPlace } from "./pickerPlaces";

/** How many of a drive folder's entries one page reads. */
const PAGE = 100;

/** One thing the picker lists: a file or folder in the Space's drive, or in a project on this computer. */
export type PickerEntry =
  | {
      id: string;
      kind: "drive";
      name: string;
      folder: boolean;
      size: number;
      /** Milliseconds since the epoch. */
      changedAt: number;
      entry: DriveEntry;
    }
  | {
      id: string;
      kind: "local";
      name: string;
      folder: boolean;
      size: number;
      /** Milliseconds since the epoch. */
      changedAt: number;
      path: string;
    };

export const isFolderEntry = (entry: PickerEntry) => entry.folder;

export type PickerListing =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; entries: PickerEntry[]; more?: () => void; loadingMore?: boolean };

const driveEntry = (entry: DriveEntry): PickerEntry => ({
  id: `drive:${entry.id}`,
  kind: "drive",
  name: entry.name,
  folder: entry.kind === "folder",
  size: entry.size,
  changedAt: entry.mtime_ms,
  entry,
});

/**
 * What the place holds that the app can open: a folder of the Space's drive (a page at a time) or of
 * a project, its folders and the files the app accepts, without the hidden ones Finder hides too.
 */
export function usePickerListing(
  spaceId: string,
  place: PickerPlace,
  accept: readonly string[],
): PickerListing & { retry(): void } {
  const [listing, setListing] = useState<PickerListing>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const acceptKey = accept.join(",");

  useEffect(() => {
    let live = true;
    setListing({ status: "loading" });
    const accepted = (name: string, mime: string) => acceptsFile(accept, mime, name);
    // This computer as a whole lists nothing: its folders are the sidebar's.
    if (place.kind === "computer") {
      setListing({ status: "ready", entries: [] });
      return;
    }
    if (place.kind === "folder") {
      filesApi.listDir(place.path).then(
        (entries) => {
          if (!live) return;
          const shown: PickerEntry[] = entries
            .filter((entry) => !entry.name.startsWith("."))
            .filter((entry) => entry.isDir || accepted(entry.name, mimeFromName(entry.name)))
            .map((entry): PickerEntry => {
              const path = childPath(place.path, entry.name);
              return {
                id: `local:${path}`,
                kind: "local",
                name: entry.name,
                folder: entry.isDir,
                size: entry.size,
                changedAt: entry.mtimeMs,
                path,
              };
            });
          setListing({ status: "ready", entries: shown });
        },
        () => live && setListing({ status: "failed" }),
      );
      return () => {
        live = false;
      };
    }

    let shown: PickerEntry[] = [];
    let next: string | undefined;
    const folder = place.path;
    const read = (after?: string) =>
      driveNative.list(place.spaceId, folder, { cursor: after, limit: PAGE }).then(
        (page) => {
          if (!live) return;
          shown = [
            ...shown,
            ...page.entries
              .filter((entry) => !entry.name.startsWith("."))
              .filter(
                (entry) => entry.kind === "folder" || accepted(entry.name, mimeFromName(entry.name)),
              )
              .map(driveEntry),
          ];
          ready(page.next_cursor ?? undefined);
        },
        () => {
          if (!live) return;
          if (!after) return setListing({ status: "failed" });
          // What already loaded stays; Load more tries the same page again.
          notify({ message: "More of Files couldn't load.", tone: "error" });
          ready(after);
        },
      );
    const ready = (cursor: string | undefined) => {
      next = cursor;
      setListing({
        status: "ready",
        entries: shown,
        more: cursor
          ? () => {
              setListing({ status: "ready", entries: shown, loadingMore: true });
              void read(cursor);
            }
          : undefined,
      });
    };
    // Rows already listed follow the drive: who has a file open, its sync state, a rename, a
    // move away or a delete. New files show the next time the folder is read.
    const stopChanges = onDriveChanged((changed) => {
      if (!live || changed.space_id !== place.spaceId) return;
      const gone = new Set(changed.removed ?? []);
      const updates = new Map<string, DriveEntry>();
      for (const item of changed.items) {
        if (item.removed || item.trashed) gone.add(item.id);
        else updates.set(item.id, item);
      }
      let touched = false;
      shown = shown.flatMap((row) => {
        if (row.kind !== "drive") return [row];
        const update = updates.get(row.entry.id);
        if (gone.has(row.entry.id) || (update && driveParent(update.path) !== drivePath(folder))) {
          touched = true;
          return [];
        }
        if (!update) return [row];
        touched = true;
        return [driveEntry(update)];
      });
      if (touched) ready(next);
    });
    void read();
    return () => {
      live = false;
      stopChanges();
    };
    // `place` and `accept` stand in by their keys: callers make them again on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, placeKey(place), acceptKey, attempt]);

  return { ...listing, retry: () => setAttempt((count) => count + 1) };
}

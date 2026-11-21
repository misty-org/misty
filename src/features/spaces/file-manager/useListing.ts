import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  disk,
  fileEvents,
  onFilesEvent,
  type FolderChange,
  type IndexStatus,
} from "@/features/files";
import { useDriveList } from "../drive";
import { messageOf } from "./format";
import { listPlace } from "./listFolder";
import { diskItem, driveItem, finderOrder, parentOf, placeKey, type FileItem, type FilesPlace } from "./model";

export type ListingState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; items: FileItem[]; more?: () => void; loadingMore?: boolean };

export type Listing = ListingState & {
  /** Reads the place again behind what shows, after a change Files made itself. */
  reload(): void;
  /** Reads it again from the start, after it failed. */
  retry(): void;
};

/** How long a burst of changes in a watched folder waits before the folder is read again. */
const SETTLE_MS = 150;

/**
 * What the open place holds. A disk folder is watched (`files_watch`), so what changes in it shows on its
 * own; a Space drive's folder follows the drive (`useDriveList`); anything else is read again after Files
 * changes it (`reload`). Hidden names show only with `hidden`.
 */
export function usePlaceListing(place: FilesPlace, hidden: boolean): Listing {
  const drivePlace = place.kind === "space-drive" ? place : undefined;
  const drive = useDriveList(drivePlace?.spaceId, drivePlace?.path ?? "/");
  const [state, setState] = useState<ListingState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const readRef = useRef<() => void>(() => {});
  const key = placeKey(place);
  const placeRef = useRef(place);
  placeRef.current = place;

  useEffect(() => {
    const current = placeRef.current;
    if (current.kind === "space-drive") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ status: "loading" });
    const read = () =>
      void listPlace(current, hidden).then(
        (items) => live && setState({ status: "ready", items }),
        (cause) =>
          live &&
          setState((shown) =>
            // A failed read again keeps what shows; only a first load shows the error.
            shown.status === "ready"
              ? shown
              : { status: "failed", message: messageOf(cause, "This folder couldn't open.") },
          ),
      );
    readRef.current = read;
    read();
    if (current.kind !== "disk") return () => void (live = false);
    const folder = current.path;
    void disk.watch(folder).catch(() => undefined);
    const stop = onFilesEvent<FolderChange>(fileEvents.changed, (change) => {
      if (change.path !== folder && parentOf(change.path) !== folder) return;
      clearTimeout(timer);
      timer = setTimeout(read, SETTLE_MS);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      stop();
      void disk.unwatch(folder).catch(() => undefined);
    };
  }, [key, hidden, attempt]);

  const driveRetry = drive.retry;
  const reload = useCallback(() => {
    if (placeRef.current.kind === "space-drive") return;
    readRef.current();
  }, []);
  const retry = useCallback(() => {
    if (placeRef.current.kind === "space-drive") driveRetry();
    else setAttempt((count) => count + 1);
  }, [driveRetry]);

  const driveState = useMemo((): ListingState => {
    if (drive.status !== "ready") return drive;
    const entries = hidden ? drive.entries : drive.entries.filter((entry) => !entry.name.startsWith("."));
    return {
      status: "ready",
      items: entries.map(driveItem).sort(finderOrder),
      more: drive.more,
      loadingMore: drive.loadingMore,
    };
  }, [drive, hidden]);

  return { ...(drivePlace ? driveState : state), reload, retry };
}

/** Where the search index is: off, still indexing, or ready. Follows `files://index`. */
export function useIndexStatus(on: boolean): IndexStatus {
  const [status, setStatus] = useState<IndexStatus>({ state: "off", files: 0 });
  useEffect(() => {
    if (!on) return;
    let live = true;
    void disk.indexStatus().then(
      (next) => live && setStatus(next),
      () => undefined,
    );
    const stop = onFilesEvent<IndexStatus>(fileEvents.index, (next) => live && setStatus(next));
    return () => {
      live = false;
      stop();
    };
  }, [on]);
  return status;
}

/** How many results one search shows. */
const SEARCH_LIMIT = 500;
/** How long typing waits before it searches. */
const SEARCH_WAIT_MS = 200;

/**
 * The index's answer for a query inside a disk folder, once the index is ready; null when there is no
 * query or the index can't answer, so the caller filters the folder by name instead.
 */
export function useIndexSearch(
  place: FilesPlace,
  query: string,
  index: IndexStatus,
): ListingState | null {
  const needle = query.trim();
  const scope = place.kind === "disk" ? place.path : null;
  const usable = Boolean(needle && scope && index.state === "ready");
  const [state, setState] = useState<ListingState>({ status: "loading" });
  useEffect(() => {
    if (!usable || !scope) return;
    let live = true;
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      void disk.search(needle, scope, SEARCH_LIMIT).then(
        (entries) => live && setState({ status: "ready", items: entries.map(diskItem) }),
        (cause) => live && setState({ status: "failed", message: messageOf(cause, "Search couldn't run.") }),
      );
    }, SEARCH_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [usable, needle, scope]);
  return usable ? state : null;
}

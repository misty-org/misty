import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import {
  driveNative,
  driveParent,
  drivePath,
  onDriveStatus,
  subscribeDriveChanged,
  type DriveChanged,
  type DriveEntry,
  type DriveSpaceStatus,
} from "./drive_native";

const PAGE = 200;

interface DriveStatusStore {
  bySpace: Record<string, DriveSpaceStatus> | null;
  failed: boolean;
}

const useDriveStatusStore = create<DriveStatusStore>(() => ({ bySpace: null, failed: false }));

let statusFollowers = 0;
let stopStatus: (() => void) | null = null;

function applyStatus(next: DriveSpaceStatus | DriveSpaceStatus[]) {
  const list = Array.isArray(next) ? next : [next];
  useDriveStatusStore.setState((state) => ({
    bySpace: {
      ...(state.bySpace ?? {}),
      ...Object.fromEntries(list.map((status) => [status.space_id, status])),
    },
    failed: false,
  }));
}

export function reportDriveFailure(spaceIds: string[], message: string): DriveSpaceStatus[] {
  const failed = spaceIds.map((space_id): DriveSpaceStatus => ({
    space_id,
    status: "failed",
    message,
    pending_uploads: 0,
    pending_downloads: 0,
  }));
  applyStatus(failed);
  return failed;
}

function readStatus() {
  driveNative.status().then(
    (list) => {
      useDriveStatusStore.setState({
        bySpace: Object.fromEntries(list.map((status) => [status.space_id, status])),
        failed: false,
      });
    },
    () => useDriveStatusStore.setState({ failed: true }),
  );
}

function followStatus(): () => void {
  statusFollowers += 1;
  if (statusFollowers === 1) {
    stopStatus = onDriveStatus(applyStatus);
    readStatus();
  }
  return () => {
    statusFollowers -= 1;
    if (statusFollowers === 0) {
      stopStatus?.();
      stopStatus = null;
    }
  };
}

export function useDriveStatus(spaceId?: string) {
  useEffect(followStatus, []);
  const bySpace = useDriveStatusStore((state) => state.bySpace);
  const failed = useDriveStatusStore((state) => state.failed);
  return {
    ready: bySpace !== null,
    failed,
    bySpace: bySpace ?? {},
    status: spaceId ? bySpace?.[spaceId] : undefined,
    retry: readStatus,
  };
}

export type DriveListState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; entries: DriveEntry[]; more?: () => void; loadingMore?: boolean };

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";

function removedIds(changed: DriveChanged): Set<string> {
  const ids = new Set(changed.removed ?? []);
  for (const item of changed.items) if (item.removed || item.trashed) ids.add(item.id);
  return ids;
}

export function applyDriveChange(
  folder: string,
  entries: DriveEntry[],
  changed: DriveChanged,
): DriveEntry[] {
  const gone = removedIds(changed);
  const here = new Set(entries.map((entry) => entry.id));
  const touches = changed.items.some(
    (item) => here.has(item.id) || driveParent(item.path) === folder,
  );
  if (!touches && ![...gone].some((id) => here.has(id))) return entries;
  const updates = new Map<string, DriveEntry>();
  for (const item of changed.items) if (!gone.has(item.id)) updates.set(item.id, item);
  const next: DriveEntry[] = [];
  for (const entry of entries) {
    if (gone.has(entry.id)) continue;
    const update = updates.get(entry.id);
    if (!update) next.push(entry);
    else if (driveParent(update.path) === folder) next.push(update);
    updates.delete(entry.id);
  }
  for (const update of updates.values()) if (driveParent(update.path) === folder) next.push(update);
  return next;
}

export function useDriveList(spaceId: string | undefined, path: string) {
  const folder = drivePath(path);
  const [state, setState] = useState<DriveListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const entries = useRef<DriveEntry[]>([]);

  useEffect(() => {
    entries.current = [];
    if (!spaceId) return void setState({ status: "ready", entries: [] });
    let live = true;
    setState({ status: "loading" });

    const ready = (cursor: string | null | undefined) =>
      setState({
        status: "ready",
        entries: entries.current,
        more: cursor
          ? () => {
              setState({ status: "ready", entries: entries.current, loadingMore: true });
              read(cursor);
            }
          : undefined,
      });
    let held: DriveChanged[] | null = [];
    const read = (cursor?: string) =>
      driveNative.list(spaceId, folder, { cursor, limit: PAGE }).then(
        (page) => {
          if (!live) return;
          const known = new Set(entries.current.map((entry) => entry.id));
          entries.current = [
            ...entries.current,
            ...page.entries.filter((entry) => !known.has(entry.id)),
          ];
          if (held) {
            for (const changed of held) {
              entries.current = applyDriveChange(folder, entries.current, changed);
            }
            held = null;
          }
          ready(page.next_cursor);
        },
        (cause) => {
          if (!live) return;
          if (cursor) return ready(cursor);
          setState({ status: "failed", message: messageOf(cause) });
        },
      );

    const subscription = subscribeDriveChanged((changed) => {
      if (!live || changed.space_id !== spaceId) return;
      if (held) {
        held.push(changed);
        return;
      }
      const next = applyDriveChange(folder, entries.current, changed);
      if (next === entries.current) return;
      entries.current = next;
      setState((current) =>
        current.status === "ready" ? { ...current, entries: entries.current } : current,
      );
    });
    void subscription.ready.then(() => {
      if (live) void read();
    });
    return () => {
      live = false;
      subscription.stop();
    };
  }, [spaceId, folder, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...state, retry };
}

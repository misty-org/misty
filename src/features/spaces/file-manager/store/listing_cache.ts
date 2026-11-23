import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { disk, fileEvents, onFilesEvent, type FolderDelta } from "@/features/files";
import { applyDriveChange, drivePath, onDriveChanged, type DriveChanged } from "../../drive";
import { messageOf } from "../format";
import { listPlace } from "../list_folder";
import { diskItem, driveItem, placeKey, type FileItem, type FilesPlace } from "../model";

export type ListingStatus = "loading" | "ready" | "failed";

export interface ListingEntry {
  items: FileItem[] | null;
  status: ListingStatus;
  error?: string;
  generation: number;
  updatedAt: number;
}

export interface Listing extends ListingEntry {
  retry(): void;
}

type Patch = (items: FileItem[]) => FileItem[];

interface Live {
  place: FilesPlace;
  hidden: boolean;
  refs: number;
  watchId?: string;
  stop?: () => void;
  reading: boolean;
  queued: Patch[];
}

const KEPT = 80;
const TRASH_SETTLE_MS = 300;
const EARLY_KEPT = 256;
const empty: ListingEntry = { items: null, status: "loading", generation: 0, updatedAt: 0 };

export const useListingStore = create<{ entries: Record<string, ListingEntry> }>(() => ({
  entries: {},
}));

const live = new Map<string, Live>();
const issued = new Map<string, number>();
const byWatch = new Map<string, string>();
let opening = 0;
let early: FolderDelta[] = [];
let stopFolderEvents: (() => void) | null = null;

export const listingKey = (place: FilesPlace, hidden: boolean) =>
  `${placeKey(place)}|${hidden ? "all" : "shown"}`;

const entryOf = (key: string) => useListingStore.getState().entries[key];

function put(key: string, change: Partial<ListingEntry>) {
  useListingStore.setState((state) => ({
    entries: { ...state.entries, [key]: { ...(state.entries[key] ?? empty), ...change } },
  }));
}

function trim() {
  const entries = useListingStore.getState().entries;
  const keys = Object.keys(entries);
  if (keys.length <= KEPT) return;
  const idle = keys
    .filter((key) => !live.get(key)?.refs)
    .sort((a, b) => entries[a].updatedAt - entries[b].updatedAt);
  const drop = new Set(idle.slice(0, keys.length - KEPT));
  if (!drop.size) return;
  for (const key of drop) issued.delete(key);
  useListingStore.setState((state) => ({
    entries: Object.fromEntries(Object.entries(state.entries).filter(([key]) => !drop.has(key))),
  }));
}

const nextGeneration = (key: string) => {
  const generation = (issued.get(key) ?? 0) + 1;
  issued.set(key, generation);
  return generation;
};

function patch(key: string, change: Patch) {
  const state = live.get(key);
  if (state?.reading) state.queued.push(change);
  const items = entryOf(key)?.items;
  if (!items) return;
  const next = change(items);
  if (next !== items) put(key, { items: next, status: "ready", updatedAt: Date.now() });
}

function landed(key: string, items: FileItem[], generation: number) {
  if (issued.get(key) !== generation) return;
  const state = live.get(key);
  let next = items;
  if (state) {
    for (const change of state.queued) next = change(next);
    state.queued = [];
    state.reading = false;
  }
  put(key, { items: next, status: "ready", error: undefined, generation, updatedAt: Date.now() });
}

function missed(key: string, cause: unknown, generation: number) {
  if (issued.get(key) !== generation) return;
  const state = live.get(key);
  if (state) {
    state.reading = false;
    state.queued = [];
  }
  const shown = entryOf(key);
  const message = messageOf(cause, "This folder couldn't open.");
  if (shown?.items) put(key, { status: "ready", error: message, generation });
  else put(key, { status: "failed", error: message, generation, updatedAt: Date.now() });
}

function read(key: string) {
  const state = live.get(key);
  const place = state?.place;
  if (!state || !place) return;
  const generation = nextGeneration(key);
  state.reading = true;
  state.queued = [];
  if (!entryOf(key)?.items) put(key, { status: "loading", error: undefined, generation });
  void listPlace(place, state.hidden).then(
    (items) => landed(key, items, generation),
    (cause) => missed(key, cause, generation),
  );
}

const shownBy = (hidden: boolean) => (item: FileItem) => hidden || !item.hidden;

function applyDelta(key: string, delta: FolderDelta) {
  if (delta.reset) return read(key);
  const state = live.get(key);
  const keep = shownBy(state?.hidden ?? false);
  const gone = new Set(delta.removed);
  const changed = new Map(delta.changed.map((entry) => [entry.path, entry]));
  const added = delta.added.filter((entry) => !gone.has(entry.path));
  patch(key, (items) => {
    const known = new Set<string>();
    const next: FileItem[] = [];
    for (const item of items) {
      if (gone.has(item.id)) continue;
      known.add(item.id);
      const update = changed.get(item.id);
      const kept = update ? diskItem(update) : item;
      if (keep(kept)) next.push(kept);
    }
    for (const entry of [...added, ...delta.changed])
      if (!known.has(entry.path)) {
        known.add(entry.path);
        const made = diskItem(entry);
        if (keep(made)) next.push(made);
      }
    return next;
  });
}

function followFolders() {
  if (stopFolderEvents) return;
  stopFolderEvents = onFilesEvent<FolderDelta>(fileEvents.folder, (delta) => {
    const key = byWatch.get(delta.id);
    if (key) return applyDelta(key, delta);
    if (opening > 0) early = [...early, delta].slice(-EARLY_KEPT);
  });
}

function openWatch(key: string, path: string, hidden: boolean) {
  const state = live.get(key);
  if (!state) return;
  followFolders();
  const generation = nextGeneration(key);
  state.reading = true;
  state.queued = [];
  if (!entryOf(key)?.items) put(key, { status: "loading", error: undefined, generation });
  opening += 1;
  void disk.watchOpen(path, hidden).then(
    (watch) => {
      opening -= 1;
      const still = live.get(key);
      if (still !== state || still.refs === 0 || still.watchId) {
        void disk.watchClose(watch.id).catch(() => undefined);
        if (opening === 0) early = [];
        return;
      }
      still.watchId = watch.id;
      byWatch.set(watch.id, key);
      landed(key, watch.entries.map(diskItem).filter(shownBy(hidden)), generation);
      const replay = early.filter((delta) => delta.id === watch.id);
      early = opening === 0 ? [] : early.filter((delta) => delta.id !== watch.id);
      for (const delta of replay) applyDelta(key, delta);
    },
    () => {
      opening -= 1;
      if (opening === 0) early = [];
      if (live.get(key) === state && state.refs) read(key);
    },
  );
}

function followDrive(key: string, spaceId: string, path: string, hidden: boolean) {
  const folder = drivePath(path);
  const keep = shownBy(hidden);
  return onDriveChanged((changed: DriveChanged) => {
    if (changed.space_id !== spaceId) return;
    patch(key, (items) => {
      const entries = items.flatMap((item) =>
        item.source.kind === "drive" ? [item.source.entry] : [],
      );
      const next = applyDriveChange(folder, entries, changed);
      if (next === entries) return items;
      const known = new Map(
        items.flatMap((item) =>
          item.source.kind === "drive" ? [[item.source.entry, item] as const] : [],
        ),
      );
      return next.map((entry) => known.get(entry) ?? driveItem(entry)).filter(keep);
    });
  });
}

function followDriveTrash(key: string, spaceId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = onDriveChanged((changed) => {
    if (changed.space_id !== spaceId) return;
    clearTimeout(timer);
    timer = setTimeout(() => read(key), TRASH_SETTLE_MS);
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}

function start(key: string) {
  const state = live.get(key);
  if (!state) return;
  const place = state.place;
  if (place.kind === "disk") return openWatch(key, place.path, state.hidden);
  if (place.kind === "space-drive")
    state.stop = followDrive(key, place.spaceId, place.path, state.hidden);
  else if (place.kind === "space-drive-trash") state.stop = followDriveTrash(key, place.spaceId);
  read(key);
}

function stop(key: string) {
  const state = live.get(key);
  if (!state) return;
  state.stop?.();
  state.stop = undefined;
  state.reading = false;
  state.queued = [];
  if (state.watchId) {
    byWatch.delete(state.watchId);
    void disk.watchClose(state.watchId).catch(() => undefined);
    state.watchId = undefined;
  }
  nextGeneration(key);
  live.delete(key);
  trim();
}

export function retainListing(place: FilesPlace, hidden: boolean): () => void {
  const key = listingKey(place, hidden);
  let state = live.get(key);
  if (!state) {
    state = { place, hidden, refs: 0, reading: false, queued: [] };
    live.set(key, state);
  }
  state.refs += 1;
  if (state.refs === 1) start(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const now = live.get(key);
    if (!now) return;
    now.refs -= 1;
    if (now.refs === 0) stop(key);
  };
}

export function refreshListing(key: string) {
  if (live.get(key)?.refs) read(key);
}

export function refreshUnwatched() {
  for (const [key, state] of live)
    if (state.refs && state.place.kind !== "disk" && state.place.kind !== "space-drive") read(key);
}

export function cachedListing(place: FilesPlace, hidden: boolean): FileItem[] | null {
  return entryOf(listingKey(place, hidden))?.items ?? null;
}

export function useListing(place: FilesPlace | undefined, hidden: boolean): Listing {
  const key = place ? listingKey(place, hidden) : "";
  useEffect(() => {
    if (!place) return;
    return retainListing(place, hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const entry = useListingStore((state) => (key ? state.entries[key] : undefined)) ?? empty;
  const retry = useCallback(() => refreshListing(key), [key]);
  return { ...entry, retry };
}

export function useListings(places: FilesPlace[], hidden: boolean): ListingEntry[] {
  const keys = places.map((place) => listingKey(place, hidden));
  const joined = keys.join("\n");
  useEffect(() => {
    const releases = places.map((place) => retainListing(place, hidden));
    return () => releases.forEach((release) => release());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  return useListingStore(useShallow((state) => keys.map((key) => state.entries[key] ?? empty)));
}

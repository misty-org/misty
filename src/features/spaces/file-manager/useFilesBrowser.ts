import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUiMemory } from "@misty/ui";
import { mimeFromName } from "../drive";
import { acceptsFile } from "../apps/spaceAppFiles";
import { useSpacesStore } from "../list/useSpacesStore";
import { useFilesDialogs } from "./dialogs/useFilesDialogs";
import { createFileActions } from "./fileActions";
import type { FilesView } from "./FilesToolbar";
import { useFilesReveal } from "./filesReveal";
import { isMac } from "./keyLabels";
import { localPath, parentOf, placeFolder, placeKey, samePlace, type FileItem, type FilesPlace } from "./model";
import { useDriveOpenWith } from "./useDriveOpenWith";
import { useFilesPlaces, useFreeSpace } from "./useFilesPlaces";
import { useIndexSearch, useIndexStatus, usePlaceListing } from "./useListing";
import { useNavigation } from "./useNavigation";
import { useFilesOperation, useUndoState } from "./useOperations";
import { useSelection } from "./useSelection";

/** What the person chose for Files on this device: its view and whether hidden names show. */
const filesMemory = createUiMemory<{ view?: FilesView; hidden?: boolean }>({
  scope: "files-browser",
  normalize: (stored) => {
    if (!stored || typeof stored !== "object") return undefined;
    const saved = stored as Record<string, unknown>;
    return {
      view: saved.view === "grid" || saved.view === "list" || saved.view === "columns" ? saved.view : undefined,
      hidden: saved.hidden === true,
    };
  },
});

/** Files picking for an app: the kinds it opens, whether several may be picked, and the answer. */
export interface FilesPick {
  accept: readonly string[];
  multiple: boolean;
  onPick(items: FileItem[]): void;
}

/** Everything the browser holds and does, apart from drawing it. */
export function useFilesBrowser({ granted, start, pick }: { granted: boolean; start: FilesPlace; pick?: FilesPick }) {
  const memoryKey = pick ? "picker" : "page";
  const remembered = filesMemory.useEntry(memoryKey);
  const view: FilesView = remembered?.view ?? "list";
  const hidden = remembered?.hidden === true;
  const setView = useCallback(
    (next: FilesView) => filesMemory.set(memoryKey, (now) => ({ ...now, view: next })),
    [memoryKey],
  );
  const toggleHidden = useCallback(
    () => filesMemory.set(memoryKey, (now) => ({ ...now, hidden: !now?.hidden })),
    [memoryKey],
  );

  const nav = useNavigation(start);
  const { place } = nav;
  // The columns start where the person last went from the sidebar.
  const [columnRoot, setColumnRoot] = useState<FilesPlace>(start);
  const selection = useSelection(pick ? pick.multiple : true);
  const pending = useRef<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState(false);
  const [quick, setQuick] = useState<FileItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [cut, setCut] = useState<ReadonlySet<string>>(new Set());

  const listing = usePlaceListing(place, hidden);
  const places = useFilesPlaces(granted);
  const index = useIndexStatus(granted);
  const searched = useIndexSearch(place, query, index);
  const operation = useFilesOperation();
  const undo = useUndoState(granted && !pick);
  const driveSpace = place.kind === "space-drive" || place.kind === "space-drive-trash" ? place.spaceId : undefined;
  const driveOpen = useDriveOpenWith(driveSpace);
  const spaces = useSpacesStore((state) => state.spaces);
  const free = useFreeSpace(placeFolder(place), granted, revision);

  // Arriving somewhere starts with nothing picked, unless the arrival named what to pick.
  const key = placeKey(place);
  const setSelected = selection.set;
  useEffect(() => {
    setSelected(pending.current ?? []);
    pending.current = null;
    setQuery("");
  }, [key, setSelected]);

  const go = useCallback(
    (next: FilesPlace, options?: { replace?: boolean; select?: string[]; root?: boolean }) => {
      if (options?.select) pending.current = options.select;
      if (options?.root) setColumnRoot(next);
      if (samePlace(next, place) && options?.select) setSelected(options.select);
      nav.go(next, options?.replace);
    },
    [nav, place, setSelected],
  );

  // An agent's `files.reveal`: its folder, with it picked.
  const reveal = useFilesReveal();
  useEffect(() => {
    if (!reveal.path || !granted || pick) return;
    const folder: FilesPlace = { kind: "disk", path: parentOf(reveal.path) };
    go(folder, { select: [reveal.path], root: true });
    useFilesReveal.setState({ path: null });
  }, [reveal.path, reveal.at, granted, pick, go]);

  const needle = query.trim().toLocaleLowerCase();
  const shown = searched ?? listing;
  const items = useMemo(() => {
    if (shown.status !== "ready") return [];
    let list = shown.items;
    if (!searched && needle) list = list.filter((item) => item.name.toLocaleLowerCase().includes(needle));
    if (pick?.accept.length)
      list = list.filter((item) => item.folder || acceptsFile(pick.accept, mimeFromName(item.name), item.name));
    return list;
  }, [shown, searched, needle, pick]);
  const selectedItems = useMemo(() => items.filter((item) => selection.selected.includes(item.id)), [items, selection.selected]);

  const changed = useCallback(() => {
    listing.reload();
    undo.refresh();
    places.refresh();
    setRevision((count) => count + 1);
  }, [listing, undo, places]);

  const dialogs = useFilesDialogs({
    run: operation.run,
    trash: async (paths) => {
      await actionsRef.current?.trash(items.filter((item) => paths.includes(item.id)));
    },
  });

  const openDrive = (item: FileItem) => {
    if (item.source.kind !== "drive") return;
    const apps = driveOpen.appsFor(item.source.entry);
    if (apps.length) driveOpen.openIn(item.source.entry, apps[0].id);
    else setQuick(item);
  };

  const actions = createFileActions({
    place,
    granted,
    changed,
    run: operation.run,
    ask: dialogs.ask,
    select: setSelected,
    go: (next) => go(next),
    quickLook: setQuick,
    openDrive,
    pick: pick ? (picked) => pick.onPick(picked.filter((item) => !item.folder)) : undefined,
  });
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const clip = (targets: FileItem[], cutting: boolean) => {
    actions.clip(targets, cutting);
    setCut(new Set(cutting ? targets.map((item) => item.id) : []));
  };

  /** Where items dropped on a place go, on the disk or into a Space's drive. */
  const dropInto = (folder: FilesPlace, dropped: FileItem[], copy: boolean) => {
    if (folder.kind === "disk" || folder.kind === "project") void actions.drop(dropped, { dir: folder.path }, copy);
    else if (folder.kind === "space-drive") void actions.drop(dropped, { spaceId: folder.spaceId, path: folder.path }, copy);
  };

  // The server names `drive.purge` apart from the permissions the renderer lists, so it is read as text.
  const canPurge = (spaceId: string) => {
    const held: readonly string[] = spaces.find((space) => space.id === spaceId)?.permissions ?? [];
    return held.includes("drive.purge") || held.includes("administrator");
  };

  return {
    pick,
    granted,
    macos: isMac,
    view,
    setView,
    hidden,
    toggleHidden,
    nav,
    place,
    go,
    columnRoot,
    selection,
    query,
    setQuery,
    info,
    setInfo,
    quick,
    setQuick,
    revision,
    cut,
    clip,
    listing,
    searched,
    shown,
    items,
    selectedItems,
    places,
    index,
    operation,
    undo,
    driveOpen,
    free,
    dialogs: dialogs.node,
    actions,
    dropInto,
    canPurge,
    localPath,
  };
}

export type FilesBrowserState = ReturnType<typeof useFilesBrowser>;

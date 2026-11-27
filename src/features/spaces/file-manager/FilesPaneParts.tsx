// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { memo, useMemo } from "react";
import { notify, Portal } from "@misty/ui";
import { disk } from "@/features/files";
import { useSpacesStore } from "../list/use_spaces_store";
import { enclosing, pathSegments, searchLocations, typedPath } from "./browser_parts";
import { canCreateIn, canPasteIn } from "./file_actions";
import { canDropIn, draggedItems } from "./file_drag";
import { FileInspector } from "./FileInspector";
import { FilesListFooter } from "./FilesBottomBar";
import { useFilesChoices, type FilesPickFooter } from "./files_choices";
import type { SearchSuggest } from "./FilesSearch";
import { FilesSidebar } from "./FilesSidebar";
import { FilesActionBar, FilesNavBar, MoreRows, type FilesMoreMenu } from "./FilesToolbar";
import { messageOf } from "./format";
import { isMac } from "./key_labels";
import {
  browsable,
  inSpaceTrash,
  isSpaceTrash,
  isSpaceTrashFolder,
  localPath,
  mayEmptySpaceTrash,
  parentOf,
  placeFolder,
  type FileItem,
} from "./model";
import { usePane } from "./pane_context";
import { QuickLook } from "./QuickLook";
import { sourceOf } from "./sources";
import { useBrowser } from "./store/browser_store";
import { listingKey, refreshListing } from "./store/listing_cache";
import { cancelOperation, refreshUndo, stepUndo, useUndo } from "./use_operations";
import { refreshPlaces, useFreeSpace, usePlacesStore } from "./use_files_places";
import { useTransfers } from "./transfers";

function useSelectedItems(shown: Map<string, FileItem>): FileItem[] {
  const selected = useBrowser((state) => state.selected);
  return useMemo(() => [...selected].flatMap((id) => shown.get(id) ?? []), [selected, shown]);
}

export const PaneToolbar = memo(function PaneToolbar({
  shown,
  empty,
  onTransfers,
  tools,
}: {
  shown: Map<string, FileItem>;
  empty: boolean;
  onTransfers?: () => void;
  tools: HTMLElement | null;
}) {
  const { store, granted, pick, actions, searchRef } = usePane();
  const picking = Boolean(pick);
  const choices = useFilesChoices(picking);
  const place = useBrowser((state) => state.place);
  const canBack = useBrowser((state) => state.at > 0);
  const canForward = useBrowser((state) => state.at < state.history.length - 1);
  const query = useBrowser((state) => state.query);
  const pathEdit = useBrowser((state) => state.pathEdit);
  const selectedItems = useSelectedItems(shown);
  const places = usePlacesStore((state) => state.places);
  const spaces = useSpacesStore((state) => state.spaces);
  const undo = useUndo(granted && !picking);
  const state = store.getState();

  const go = state.go;
  const segments = pathSegments(place, places, spaces, (next) => go(next));
  const title = segments[segments.length - 1]?.label ?? "Files";
  const up = enclosing(place);
  const local = selectedItems.length > 0 && selectedItems.every((item) => localPath(item));
  const one = selectedItems.length === 1 ? selectedItems[0] : undefined;
  const renamable = one !== undefined && sourceOf(one).canRename;
  const trashable =
    selectedItems.length > 0 &&
    selectedItems.every((item) => sourceOf(item).canTrash && !isSpaceTrash(item));
  const inSystemTrash = place.kind === "trash";
  const mayPurgeIn = (spaceId: string) =>
    mayEmptySpaceTrash(spaces.find((space) => space.id === spaceId)?.permissions);
  const firstSource = selectedItems[0]?.source;
  const binned = selectedItems.length > 0 && selectedItems.every(inSpaceTrash);
  const mayPurgeBinned =
    binned && firstSource?.kind === "drive" && mayPurgeIn(firstSource.entry.space_id);
  const trashSpace = isSpaceTrashFolder(place) && place.kind === "space-drive" ? place.spaceId : "";
  const mayEmpty = trashSpace !== "" && mayPurgeIn(trashSpace);
  const folderPath = typedPath(place);
  const hiddenToggle = browsable(place)
    ? { shown: choices.hidden, toggle: choices.toggleHidden }
    : undefined;
  const duplicates =
    granted && place.kind === "disk" ? () => actions.duplicates(place.path) : undefined;

  const goPath = (text: string) => {
    const home = places?.home;
    const path = home && (text === "~" || text.startsWith("~/")) ? `${home}${text.slice(1)}` : text;
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) go({ kind: "disk", path });
    else
      notify({
        message: `There's no folder at “${text}”. Type a whole path, such as ~/Documents.`,
        tone: "error",
      });
  };
  const more: FilesMoreMenu = {
    sort: { value: choices.sort, set: choices.setSort },
    hidden: hiddenToggle,
    refresh: () => {
      refreshListing(listingKey(store.getState().place, choices.hidden));
      refreshUndo();
      refreshPlaces();
      store.getState().bump();
    },
    copyFolderPath: folderPath
      ? () =>
          void navigator.clipboard
            .writeText(folderPath)
            .catch(() => notify({ message: "Couldn't copy the path.", tone: "error" }))
      : undefined,
    copySelectedPath: selectedItems.length ? () => actions.copyPath(selectedItems) : undefined,
    duplicates,
    emptyTrash: mayEmpty && !empty ? () => actions.emptyTrash(trashSpace) : undefined,
  };
  const terminalAt = place.kind === "disk" || place.kind === "project" ? place.path : undefined;
  const suggest: SearchSuggest | undefined = picking
    ? undefined
    : {
        locations: searchLocations(places, spaces, granted),
        indexed: granted,
        onPlace: (next) => go(next, { root: true }),
        onEntry: (entry) =>
          entry.kind === "folder"
            ? go({ kind: "disk", path: entry.path })
            : go({ kind: "disk", path: parentOf(entry.path) }, { select: [entry.path] }),
      };
  const columnsShown = choices.view === "columns" && browsable(place);

  return (
    <>
      <FilesNavBar
        back={state.back}
        forward={state.forward}
        canBack={canBack}
        canForward={canForward}
        up={up ? () => go(up) : undefined}
        refresh={more.refresh}
        path={segments}
        typed={folderPath}
        onPath={granted ? goPath : undefined}
        pathEdit={pathEdit}
        query={query}
        onQuery={state.setQuery}
        searchRef={searchRef}
        searchLabel={`Search ${title}`}
        suggest={suggest}
        onTransfers={onTransfers}
      />
      {picking || !tools ? null : (
        <Portal container={tools}>
          <FilesActionBar
            create={canCreateIn(place, granted) ? actions.create : undefined}
            undo={
              granted
                ? {
                    label: undo.undo,
                    redoLabel: undo.redo,
                    run: () => void stepUndo("undo"),
                    redo: () => void stepUndo("redo"),
                  }
                : undefined
            }
            cut={local && granted ? () => actions.clip(selectedItems, true) : undefined}
            copy={local ? () => actions.clip(selectedItems, false) : undefined}
            paste={
              placeFolder(place) && canPasteIn(place, granted)
                ? () => void actions.paste()
                : undefined
            }
            restore={
              inSystemTrash || trashSpace
                ? { run: selectedItems.length ? () => actions.putBack(selectedItems) : undefined }
                : undefined
            }
            rename={one && renamable ? () => actions.rename(one) : undefined}
            trash={
              !inSystemTrash && trashable && (!binned || mayPurgeBinned)
                ? () => void actions.trash(selectedItems)
                : undefined
            }
            view={columnsShown ? "columns" : choices.view === "columns" ? "list" : choices.view}
            onView={choices.setView}
            columns={browsable(place)}
            zoom={choices.zoom}
            onZoom={choices.setZoom}
            more={<MoreRows menu={more} />}
            terminal={
              terminalAt
                ? () =>
                    void disk.openTerminal(terminalAt).catch((cause) =>
                      notify({
                        message: messageOf(cause, "The terminal couldn't open."),
                        tone: "error",
                      }),
                    )
                : undefined
            }
          />
        </Portal>
      )}
    </>
  );
});

export const PaneSidebar = memo(function PaneSidebar({ shown }: { shown: Map<string, FileItem> }) {
  const { store, granted, pick, actions } = usePane();
  const picking = Boolean(pick);
  const choices = useFilesChoices(picking);
  const place = useBrowser((state) => state.place);
  const places = usePlacesStore((state) => state.places);
  const tags = usePlacesStore((state) => state.tags);
  return (
    <FilesSidebar
      current={place}
      granted={granted}
      picking={picking}
      places={places}
      tags={tags}
      macos={isMac}
      folded={choices.folded}
      onFold={choices.setFolded}
      onGo={(next) => store.getState().go(next, { root: true })}
      drop={
        picking
          ? undefined
          : {
              canDrop: (at, ids, copy) => canDropIn(at, draggedItems(ids, shown), copy),
              onDrop: (at, ids, copy) => actions.dropInto(at, draggedItems(ids, shown), copy),
            }
      }
    />
  );
});

export const PaneInspector = memo(function PaneInspector({
  shown,
  hidden,
}: {
  shown: Map<string, FileItem>;
  hidden: boolean;
}) {
  const { actions } = usePane();
  const place = useBrowser((state) => state.place);
  const lead = useBrowser((state) => state.lead);
  const selectedItems = useSelectedItems(shown);
  return (
    <FileInspector
      items={selectedItems}
      lead={lead}
      from={place}
      hidden={hidden}
      onOpen={actions.open}
    />
  );
});

export const PaneFooter = memo(function PaneFooter({
  shown,
  count,
}: {
  shown: Map<string, FileItem>;
  count: number | null;
}) {
  const { granted } = usePane();
  const place = useBrowser((state) => state.place);
  const revision = useBrowser((state) => state.revision);
  const opId = useBrowser((state) => state.opId);
  const transfer = useTransfers((state) => (opId ? state.byId[opId] : undefined));
  const selectedItems = useSelectedItems(shown);
  const free = useFreeSpace(placeFolder(place), granted, revision);
  const selectedBytes = selectedItems.reduce((sum, item) => sum + (item.folder ? 0 : item.size), 0);
  return (
    <FilesListFooter
      count={count}
      selected={selectedItems.length}
      selectedBytes={selectedBytes}
      free={free}
      progress={
        transfer
          ? {
              opId: transfer.opId,
              label: transfer.label,
              doneBytes: transfer.doneBytes,
              totalBytes: transfer.totalBytes,
              item: transfer.item,
            }
          : null
      }
      onCancel={
        transfer && transfer.stoppable !== false ? () => cancelOperation(transfer.opId) : undefined
      }
    />
  );
});

export const PanePickFooter = memo(function PanePickFooter({
  shown,
  footer,
}: {
  shown: Map<string, FileItem>;
  footer: FilesPickFooter;
}) {
  const { actions } = usePane();
  const selectedItems = useSelectedItems(shown);
  const place = useBrowser((state) => state.place);
  return <>{footer(selectedItems, actions.open, place)}</>;
});

export function PaneQuickLook() {
  const { store } = usePane();
  const quick = useBrowser((state) => state.quick);
  if (!quick) return null;
  return <QuickLook item={quick} onClose={() => store.getState().setQuick(null)} />;
}

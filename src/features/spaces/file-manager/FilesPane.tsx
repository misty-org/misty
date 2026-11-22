// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { notify, Portal, PropertyList, Separator, Surface, Text } from "@misty/ui";
import { disk } from "@/features/files";
import { useSpacesStore } from "../list/useSpacesStore";
import { enclosing, keyCommands, pathSegments, searchLocations, typedPath } from "./browserParts";
import { ColumnsView } from "./ColumnsView";
import { collectionItem, thumbnailFor } from "./FileItems";
import { FileInspector } from "./FileInspector";
import { FilePreview } from "./FilePreview";
import { FilesListFooter } from "./FilesBottomBar";
import { handleFilesKey, shownOrder } from "./filesKeys";
import { FilesMain, type BackgroundMenu } from "./FilesMain";
import type { SearchSuggest } from "./FilesSearch";
import { FilesSidebar } from "./FilesSidebar";
import { FilesActionBar, FilesNavBar, MoreRows, type FilesMoreMenu } from "./FilesToolbar";
import { formatBytes, formatDate, kindOf, messageOf } from "./format";
import { ItemMenu, type MenuContext } from "./ItemMenu";
import { browsable, localPath, parentOf, placeFolder, placeInside, placeKey, samePlace, type FileItem, type FilesPlace } from "./model";
import { QuickLook } from "./QuickLook";
import { prewarmThumbnails } from "./thumbnails";
import { useFilesBrowser, type FilesPick, type FilesSort } from "./useFilesBrowser";

/** Where the window draws the active pane's parts: the toolbar across the top, the sidebar, the preview, the picker's buttons. */
export interface PaneSlots {
  toolbar: HTMLElement | null;
  sidebar: HTMLElement | null;
  inspector: HTMLElement | null;
  footer: HTMLElement | null;
}

/** What the window tells a pane, and how the pane reaches the tab it sits in. */
export interface PaneHost {
  /** The pane the toolbar, sidebar and preview follow. */
  active: boolean;
  slots: PaneSlots;
  /** How many panes share the tab. */
  count: number;
  onFocus(): void;
  /** The pane went somewhere; `title` names the tab. */
  onPlace(place: FilesPlace, title: string): void;
  split?: (direction: "right" | "down") => void;
  close?: () => void;
  newTab?: (place: FilesPlace) => void;
  transfers?: () => void;
}

/** A picked file in the column view's last column: its preview and its facts. */
function ColumnPreview({ item }: { item: FileItem }) {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-3 p-3">
      <div className="relative h-48 min-h-0 overflow-hidden">
        <FilePreview key={item.id} item={item} />
      </div>
      <Text weight="semibold" tone="bright" full>
        {item.name}
      </Text>
      <PropertyList
        label="Info"
        layout="stacked"
        items={[
          { label: "Kind", value: kindOf(item) },
          { label: "Size", value: formatBytes(item.size) },
          { label: "Modified", value: formatDate(item.modifiedMs) },
        ]}
      />
    </div>
  );
}

/**
 * One folder view of Files, as one of Kura's panes: its list, icons or columns on the page's color with
 * the folder's foot under it. While it is the active pane it draws its toolbar, the sidebar and the
 * preview into the window's slots, so they follow whichever pane was last used. The picker shows one
 * with `pick`, where only what opens and shows is offered and `footer` (its Open button) takes the
 * bottom bar's place.
 */
export function FilesPane({
  granted,
  start,
  pick,
  footer,
  host,
}: {
  /** The disk grant is on; off, Files reaches the Space drives and the person's projects only. */
  granted: boolean;
  /** Where it opens. */
  start: FilesPlace;
  pick?: FilesPick;
  /** The picker's buttons, from what is picked now; `open` goes into a folder or picks a file. */
  footer?: (picked: FileItem[], open: (item: FileItem) => void) => ReactNode;
  host: PaneHost;
}) {
  const state = useFilesBrowser({ granted, start, pick, revealHere: host.active });
  const { place, items, selectedItems, selection, actions, view, places } = state;
  const spaces = useSpacesStore((store) => store.spaces);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const picking = Boolean(pick);
  const columnsShown = view === "columns" && browsable(place);
  const order = () => shownOrder(scrollRef.current, items);
  const one = selectedItems.length === 1 ? selectedItems[0] : undefined;
  const folder = placeFolder(place);
  const changes = !picking;

  const menuCtx: MenuContext = {
    place,
    granted,
    picking,
    macos: state.macos,
    actions,
    starred: places.starred,
    tags: places.tags,
    quickLook: state.setQuick,
    info: (item) => {
      selection.set([item.id]);
      state.setInfo(true);
    },
    driveApps: state.driveOpen.appsFor,
    openDriveIn: state.driveOpen.openIn,
    canPurge: state.canPurge,
    openInNewTab: host.newTab
      ? (item) => {
          const inside = placeInside(item, place);
          if (inside) host.newTab?.(inside);
        }
      : undefined,
  };
  const targets = (item: FileItem) => (selection.selected.includes(item.id) ? selectedItems : [item]);
  const menuFor = (item: FileItem) => <ItemMenu items={targets(item)} ctx={menuCtx} />;
  const pointAt = (item: FileItem) => () => {
    if (!selection.selected.includes(item.id)) selection.set([item.id]);
  };
  const droppable = (item: FileItem) =>
    item.folder && !picking && (item.source.kind === "drive" || localPath(item) !== undefined);

  const collection = items.map((item) =>
    collectionItem(item, { onOpen: actions.open, menu: menuFor(item), onMenuOpen: pointAt(item), dropTarget: droppable(item) }),
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const drag =
    picking || !browsable(place)
      ? undefined
      : {
          canDrop: (target: string) => {
            const item = byId.get(target);
            return Boolean(item && droppable(item));
          },
          onDrop: (target: string | null, ids: string[], copy: boolean) => {
            const dropped = ids.flatMap((id) => byId.get(id) ?? []);
            const into = target ? byId.get(target) : undefined;
            const destination = into ? placeInside(into, place) : place;
            if (destination) state.dropInto(destination, dropped, copy);
          },
        };

  const background: BackgroundMenu = picking
    ? { hidden: browsable(place) ? { shown: state.hidden, toggle: state.toggleHidden } : undefined }
    : {
        create: actions.canCreate ? actions.create : undefined,
        paste: actions.canPaste ? () => void actions.paste() : undefined,
        duplicates: granted && place.kind === "disk" ? () => actions.duplicates(place.path) : undefined,
        emptyAgentTrash: place.kind === "agent-trash" && items.length ? actions.emptyAgentTrash : undefined,
        goToFolder: granted ? () => actions.goToFolder(places.places?.home) : undefined,
        hidden: browsable(place) ? { shown: state.hidden, toggle: state.toggleHidden } : undefined,
      };

  const up = enclosing(place);
  const segments = pathSegments(place, places.places, spaces, (next) => state.go(next));
  const title = segments[segments.length - 1]?.label ?? "Files";
  const [pathEdit, setPathEdit] = useState(0);
  const commands = {
    ...keyCommands(state, order, () => searchRef.current?.focus()),
    // Go to folder types a path into the path bar, as Kura's does.
    goToFolder: granted && !picking ? () => setPathEdit((count) => count + 1) : undefined,
  };
  const trashable =
    selectedItems.length > 0 && selectedItems.every((item) => ["disk", "project", "drive"].includes(item.source.kind));

  const refresh = () => {
    state.listing.reload();
    state.undo.refresh();
    state.places.refresh();
  };
  const goPath = (text: string) => {
    const home = places.places?.home;
    const path = home && (text === "~" || text.startsWith("~/")) ? `${home}${text.slice(1)}` : text;
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) state.go({ kind: "disk", path });
    else notify({ message: `There's no folder at “${text}”. Type a whole path, such as ~/Documents.`, tone: "error" });
  };
  const inTrash = place.kind === "trash" || place.kind === "agent-trash" || place.kind === "space-drive-trash";
  const folderPath = typedPath(place);
  const more: FilesMoreMenu = {
    sort: { value: state.sort, set: state.setSort },
    split: host.split,
    closePane: host.count > 1 ? host.close : undefined,
    hidden: background.hidden,
    refresh,
    copyFolderPath: folderPath
      ? () => void navigator.clipboard.writeText(folderPath).catch(() => notify({ message: "Couldn't copy the path.", tone: "error" }))
      : undefined,
    copySelectedPath: selectedItems.length ? () => actions.copyPath(selectedItems) : undefined,
    duplicates: background.duplicates,
    emptyAgentTrash: background.emptyAgentTrash,
  };
  const selectedBytes = selectedItems.reduce((sum, item) => sum + (item.folder ? 0 : item.size), 0);
  const terminalAt = place.kind === "disk" || place.kind === "project" ? place.path : undefined;
  const openTerminal = terminalAt
    ? () => void disk.openTerminal(terminalAt).catch((cause) => notify({ message: messageOf(cause, "The terminal couldn't open."), tone: "error" }))
    : undefined;
  const suggest: SearchSuggest | undefined = picking
    ? undefined
    : {
        locations: searchLocations(places.places, spaces, granted),
        indexed: granted,
        onPlace: (next) => state.go(next, { root: true }),
        onEntry: (entry) =>
          entry.kind === "folder"
            ? state.go({ kind: "disk", path: entry.path })
            : state.go({ kind: "disk", path: parentOf(entry.path) }, { select: [entry.path] }),
      };

  // The pane tells its tab where it is, so the tab keeps its name and the place lasts.
  const latest = useRef({ place, title, onPlace: host.onPlace });
  latest.current = { place, title, onPlace: host.onPlace };
  const key = placeKey(place);
  useEffect(() => {
    const now = latest.current;
    now.onPlace(now.place, now.title);
  }, [key, title]);

  // The grid's pictures off the screen are fetched behind the ones on it, as Kura does; the list
  // shows none, so it fetches none. The URLs stand in for the items, which each listing makes anew.
  const gridPictures = view === "grid" && host.active ? items.flatMap((item) => thumbnailFor(item) ?? []) : [];
  const gridPicturesKey = gridPictures.join("\n");
  const latestPictures = useRef(gridPictures);
  latestPictures.current = gridPictures;
  useEffect(() => {
    // An empty list still drops what the last folder hadn't started.
    prewarmThumbnails(latestPictures.current);
  }, [gridPicturesKey]);

  const columns = columnsShown ? (
    <ColumnsView
      root={state.columnRoot}
      place={place}
      hidden={state.hidden}
      revision={state.revision}
      selected={selection.selected}
      cut={state.cut}
      preview={one && !one.folder ? <ColumnPreview item={one} /> : undefined}
      onPick={(at, id, event, columnOrder) => {
        if (samePlace(at, place)) selection.pick(id, columnOrder, event);
        else state.go(at, { replace: true, select: [id] });
      }}
      onOpen={actions.open}
      menu={(item) => menuFor(item)}
      onDrop={state.dropInto}
    />
  ) : undefined;

  const toolbar = (
    <>
      <FilesNavBar
        back={state.nav.back}
        forward={state.nav.forward}
        canBack={state.nav.canBack}
        canForward={state.nav.canForward}
        up={up ? () => state.go(up) : undefined}
        refresh={refresh}
        path={segments}
        typed={folderPath}
        onPath={granted ? goPath : undefined}
        pathEdit={pathEdit}
        query={state.query}
        onQuery={state.setQuery}
        searchRef={searchRef}
        searchLabel={`Search ${title}`}
        suggest={suggest}
        onTransfers={host.transfers}
      />
      {changes ? (
        <>
          <Separator />
          <FilesActionBar
            create={actions.canCreate ? actions.create : undefined}
            undo={
              granted
                ? {
                    label: state.undo.state.undo,
                    redoLabel: state.undo.state.redo,
                    run: () => void state.undo.undo(),
                    redo: () => void state.undo.redo(),
                  }
                : undefined
            }
            cut={commands.cut}
            copy={commands.copy}
            paste={folder && actions.canPaste ? () => void actions.paste() : undefined}
            restore={inTrash ? { run: selectedItems.length ? () => actions.putBack(selectedItems) : undefined } : undefined}
            rename={commands.rename}
            trash={!inTrash && trashable ? () => void actions.trash(selectedItems) : undefined}
            view={columnsShown ? "columns" : view === "columns" ? "list" : view}
            onView={state.setView}
            columns={browsable(place)}
            zoom={state.zoom}
            onZoom={state.setZoom}
            more={<MoreRows menu={more} />}
            terminal={openTerminal}
          />
        </>
      ) : null}
    </>
  );

  const { slots } = host;
  return (
    <div
      className="relative flex size-full min-h-0 min-w-0 flex-col"
      onPointerDownCapture={host.active ? undefined : host.onFocus}
      onFocusCapture={host.active ? undefined : host.onFocus}
    >
      <Surface tone="page" dimmed={host.count > 1 && !host.active} className="flex min-h-0 flex-1 flex-col">
        <FilesMain
          place={place}
          view={columnsShown ? "columns" : view}
          zoom={state.zoom}
          sort={state.sort ?? null}
          onSort={(next) => state.setSort(next ? { key: next.key as FilesSort["key"], descending: next.descending } : undefined)}
          listing={state.searched ? { ...state.searched, retry: state.listing.retry } : state.listing}
          items={collection}
          searching={Boolean(state.query.trim())}
          selected={selection.selected}
          onSelect={(event, id, onOpen) => {
            if (event.detail >= 2) return onOpen();
            selection.pick(id, order().ids, event);
          }}
          drag={drag}
          background={background}
          columns={columns}
          scrollRef={scrollRef}
          onKeyDown={(event) => handleFilesKey(event, commands, columnsShown)}
        />
        <FilesListFooter
          count={state.shown.status === "ready" ? items.length : null}
          selected={selectedItems.length}
          selectedBytes={selectedBytes}
          free={state.free}
          progress={state.operation.progress}
          onCancel={state.operation.cancel}
          onClosePane={host.count > 1 ? host.close : undefined}
        />
      </Surface>
      {host.active && slots.toolbar ? <Portal container={slots.toolbar}>{toolbar}</Portal> : null}
      {host.active && slots.sidebar ? (
        <Portal container={slots.sidebar}>
          <FilesSidebar
            current={place}
            granted={granted}
            picking={picking}
            places={places.places}
            tags={places.tags}
            agentTrash={places.agentTrash}
            macos={state.macos}
            folded={state.folded}
            onFold={state.setFolded}
            onGo={(next) => state.go(next, { root: true })}
          />
        </Portal>
      ) : null}
      {host.active && slots.inspector ? (
        <Portal container={slots.inspector}>
          <FileInspector items={selectedItems} from={place} onOpen={actions.open} />
        </Portal>
      ) : null}
      {host.active && pick && footer && slots.footer ? <Portal container={slots.footer}>{footer(selectedItems, actions.open)}</Portal> : null}
      {state.quick ? <QuickLook item={state.quick} onClose={() => state.setQuick(null)} /> : null}
      {state.dialogs}
    </div>
  );
}

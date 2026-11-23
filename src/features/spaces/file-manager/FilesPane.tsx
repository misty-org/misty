// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Portal, PropertyList, Surface, Text, type CollectionItem } from "@misty/ui";
import { disk } from "@/features/files";
import { mimeFromName } from "../drive";
import { acceptsFile } from "../apps/space_app_files";
import { keyCommands } from "./browser_parts";
import { ColumnsView } from "./ColumnsView";
import type { FilesDialogs } from "./dialogs/UseFilesDialogs";
import { FilesDialogsHost } from "./dialogs/UseFilesDialogs";
import { canCreateIn, canPasteIn, createFileActions, fail } from "./file_actions";
import { collectionItem } from "./FileItems";
import { FilePreview } from "./FilePreview";
import { useFilesChoices, type FilesPick, type FilesSort } from "./files_choices";
import { handleFilesKey } from "./files_keys";
import { useFilesReveal } from "./files_reveal";
import { FilesMain, type BackgroundMenu, type MainListing } from "./FilesMain";
import {
  PaneFooter,
  PaneInspector,
  PanePickFooter,
  PaneQuickLook,
  PaneSidebar,
  PaneToolbar,
} from "./FilesPaneParts";
import { formatBytes, formatDate, kindOf } from "./format";
import { ItemMenuFor } from "./ItemMenu";
import { finderOrdered } from "./list_folder";
import {
  browsable,
  localPath,
  parentOf,
  placeInside,
  samePlace,
  type FileItem,
  type FilesPlace,
} from "./model";
import { PaneContext, usePane, type PaneApi } from "./pane_context";
import { useArranged } from "./store/arrange";
import { BrowserStoreContext, createBrowserStore, useBrowser } from "./store/browser_store";
import { refreshUnwatched, useListing } from "./store/listing_cache";
import { useDriveOpenWith } from "./use_drive_open_with";
import { refreshPlaces, useLoadPlaces } from "./use_files_places";
import { useIndexSearch, useIndexStatus } from "./use_listing";
import { useIgnoreOffer } from "./use_ignore_offer";
import { refreshUndo, runOperation } from "./use_operations";

export interface PaneSlots {
  toolbar: HTMLElement | null;
  tools: HTMLElement | null;
  sidebar: HTMLElement | null;
  inspector: HTMLElement | null;
  footer: HTMLElement | null;
}

const NO_ITEMS: FileItem[] = [];

function ColumnPreview({ item }: { item: FileItem }) {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-3 p-3">
      <div className="relative h-48 min-h-0 overflow-hidden">
        <FilePreview key={item.id} item={item} compact />
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

const ColumnsArea = memo(function ColumnsArea({
  shown,
  hidden,
  sort,
}: {
  shown: Map<string, FileItem>;
  hidden: boolean;
  sort: FilesSort | undefined;
}) {
  const { store, actions } = usePane();
  const place = useBrowser((state) => state.place);
  const root = useBrowser((state) => state.columnRoot);
  const selected = useBrowser((state) => state.selected);
  const cut = useBrowser((state) => state.cut);
  const ids = useMemo(() => [...selected], [selected]);
  const one = ids.length === 1 ? shown.get(ids[0]) : undefined;
  return (
    <ColumnsView
      root={root}
      place={place}
      hidden={hidden}
      sort={sort}
      selected={ids}
      cut={cut}
      preview={one && !one.folder ? <ColumnPreview item={one} /> : undefined}
      onPick={(at, id, event, columnOrder) => {
        const state = store.getState();
        if (samePlace(at, state.place)) state.pick(id, columnOrder, event);
        else state.go(at, { replace: true, select: [id] });
      }}
      onOpen={actions.open}
      menu={(item) => <ItemMenuFor item={item} />}
      onDrop={actions.dropInto}
    />
  );
});

const MainArea = memo(function MainArea({
  listing,
  items,
  searching,
  columns,
  background,
  drag,
}: {
  listing: MainListing;
  items: CollectionItem[];
  searching: boolean;
  columns?: ReactNode;
  background: BackgroundMenu;
  drag: Parameters<typeof FilesMain>[0]["drag"];
}) {
  const pane = usePane();
  const { store } = pane;
  const picking = Boolean(pane.pick);
  const choices = useFilesChoices(picking);
  const place = useBrowser((state) => state.place);
  const selected = useBrowser((state) => state.selected);
  const lead = useBrowser((state) => state.lead);
  const ids = useMemo(() => [...selected], [selected]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsShown = Boolean(columns);
  const orderIds = () => {
    const reported = pane.order.current;
    return reported.ids.length === pane.shown.current.size
      ? reported.ids
      : [...pane.shown.current.keys()];
  };
  const onShownOrder = useCallback(
    (shownIds: string[], perRow: number) => {
      pane.order.current = { ids: shownIds, perRow };
    },
    [pane],
  );
  return (
    <FilesMain
      place={place}
      view={columnsShown ? "columns" : choices.view}
      zoom={choices.zoom}
      sort={choices.sort ?? null}
      onSort={(next) =>
        choices.setSort(
          next ? { key: next.key as FilesSort["key"], descending: next.descending } : undefined,
        )
      }
      listing={listing}
      items={items}
      searching={searching}
      selected={ids}
      reveal={lead}
      onShownOrder={onShownOrder}
      onSelect={(event, id, onOpen) => {
        if (event.detail >= 2) return onOpen();
        store.getState().pick(id, orderIds(), event);
      }}
      drag={drag}
      background={background}
      columns={columns}
      scrollRef={scrollRef}
      onKeyDown={(event) =>
        handleFilesKey(
          event,
          keyCommands(pane, {
            setInfo: choices.setInfo,
            setView: choices.setView,
            toggleHidden: choices.toggleHidden,
            focusSearch: () => pane.searchRef.current?.focus(),
          }),
          columnsShown,
        )
      }
    />
  );
});

function PaneBody({
  slots,
  footer,
  onTransfers,
  driveOpen,
}: {
  slots: PaneSlots;
  footer?: (picked: FileItem[], open: (item: FileItem) => void) => ReactNode;
  onTransfers?: () => void;
  driveOpen: { current: (item: FileItem) => void };
}) {
  const pane = usePane();
  const { store, granted, pick, actions } = pane;
  const picking = Boolean(pick);
  const choices = useFilesChoices(picking);
  const { hidden, sort, view } = choices;
  const place = useBrowser((state) => state.place);
  const query = useBrowser((state) => state.query);
  const listing = useListing(place, hidden);
  useIgnoreOffer(place, listing.items, !picking);
  const index = useIndexStatus(granted);
  const searched = useIndexSearch(place, query, index);
  const base = searched
    ? searched.status === "ready"
      ? searched.items
      : NO_ITEMS
    : (listing.items ?? NO_ITEMS);
  const accept = pick?.accept;
  const accepted = useMemo(
    () =>
      accept?.length
        ? base.filter(
            (item) => item.folder || acceptsFile(accept, mimeFromName(item.name), item.name),
          )
        : base,
    [base, accept],
  );
  const needle = searched ? "" : query.trim().toLocaleLowerCase();
  const items = useArranged(accepted, {
    needle,
    sort,
    finder: !searched && finderOrdered(place),
  });
  const shown = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  useLayoutEffect(() => {
    pane.shown.current = shown;
  }, [pane, shown]);

  const driveSpace =
    place.kind === "space-drive" || place.kind === "space-drive-trash" ? place.spaceId : undefined;
  const drives = useDriveOpenWith(driveSpace);
  useLayoutEffect(() => {
    driveOpen.current = (item) => {
      if (item.source.kind !== "drive") return;
      const apps = drives.appsFor(item.source.entry);
      if (apps.length) drives.openIn(item.source.entry, apps[0].id);
      else store.getState().setQuick(item);
    };
  });

  const cards = useRef(new WeakMap<FileItem, CollectionItem>());
  const collection = useMemo(
    () =>
      items.map((item) => {
        const kept = cards.current.get(item);
        if (kept) return kept;
        const made = collectionItem(item, {
          onOpen: actions.open,
          menu: () => <ItemMenuFor item={item} />,
          onMenuOpen: () => {
            const state = store.getState();
            if (!state.selected.has(item.id)) state.select([item.id]);
          },
          dropTarget:
            item.folder &&
            !picking &&
            (item.source.kind === "drive" || localPath(item) !== undefined),
        });
        cards.current.set(item, made);
        return made;
      }),
    [items, actions, store, picking],
  );

  const drag = useMemo(
    () =>
      picking || !browsable(place)
        ? undefined
        : {
            canDrop: (target: string) => {
              const item = shown.get(target);
              return Boolean(
                item?.folder && (item.source.kind === "drive" || localPath(item) !== undefined),
              );
            },
            onDrop: (target: string | null, ids: string[], copy: boolean) => {
              const dropped = ids.flatMap((id) => shown.get(id) ?? []);
              const into = target ? shown.get(target) : undefined;
              const destination = into ? placeInside(into, place) : place;
              if (destination) actions.dropInto(destination, dropped, copy);
            },
          },
    [picking, place, shown, actions],
  );

  const hiddenToggle = browsable(place)
    ? { shown: hidden, toggle: choices.toggleHidden }
    : undefined;
  const background = useMemo(
    (): BackgroundMenu =>
      picking
        ? { hidden: hiddenToggle }
        : {
            create: canCreateIn(place, granted) ? actions.create : undefined,
            paste: canPasteIn(place, granted) ? () => void actions.paste() : undefined,
            duplicates:
              granted && place.kind === "disk" ? () => actions.duplicates(place.path) : undefined,
            emptyAgentTrash:
              place.kind === "agent-trash" && items.length ? actions.emptyAgentTrash : undefined,
            goToFolder: granted ? () => store.getState().editPath() : undefined,
            hidden: hiddenToggle,
          },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picking, place, granted, actions, store, items.length > 0, hidden, choices.toggleHidden],
  );

  const searching = Boolean(query.trim());
  const columnsShown = view === "columns" && browsable(place);
  const ready = listing.items !== null;
  const mainListing = useMemo((): MainListing => {
    if (searched)
      return {
        status: searched.status,
        message: searched.status === "failed" ? searched.message : undefined,
        retry: listing.retry,
      };
    return {
      status: ready ? "ready" : listing.status,
      message: listing.error,
      retry: listing.retry,
    };
  }, [searched, ready, listing.status, listing.error, listing.retry]);

  return (
    <div className="relative flex size-full min-h-0 min-w-0 flex-col">
      <Surface tone="page" className="flex min-h-0 flex-1 flex-col">
        <MainArea
          listing={mainListing}
          items={collection}
          searching={searching}
          columns={
            columnsShown && !searching ? (
              <ColumnsArea shown={shown} hidden={hidden} sort={sort} />
            ) : undefined
          }
          background={background}
          drag={drag}
        />
        <PaneFooter shown={shown} count={mainListing.status === "ready" ? items.length : null} />
      </Surface>
      {slots.toolbar ? (
        <Portal container={slots.toolbar}>
          <PaneToolbar
            shown={shown}
            empty={items.length === 0}
            onTransfers={onTransfers}
            tools={slots.tools}
          />
        </Portal>
      ) : null}
      {slots.sidebar ? (
        <Portal container={slots.sidebar}>
          <PaneSidebar />
        </Portal>
      ) : null}
      {slots.inspector ? (
        <Portal container={slots.inspector}>
          <PaneInspector shown={shown} hidden={hidden} />
        </Portal>
      ) : null}
      {pick && footer && slots.footer ? (
        <Portal container={slots.footer}>
          <PanePickFooter shown={shown} footer={footer} />
        </Portal>
      ) : null}
      <PaneQuickLook />
    </div>
  );
}

export function FilesPane({
  granted,
  start,
  pick,
  footer,
  slots,
  onTransfers,
}: {
  granted: boolean;
  start: FilesPlace;
  pick?: FilesPick;
  footer?: (picked: FileItem[], open: (item: FileItem) => void) => ReactNode;
  slots: PaneSlots;
  onTransfers?: () => void;
}) {
  const [store] = useState(() => createBrowserStore(start, pick ? pick.multiple : true));
  const dialogs = useRef<FilesDialogs | null>(null);
  const driveOpen = useRef<(item: FileItem) => void>(() => undefined);
  const pickRef = useRef(pick);
  useLayoutEffect(() => {
    pickRef.current = pick;
  });
  const shown = useRef(new Map<string, FileItem>());
  const order = useRef({ ids: [] as string[], perRow: 1 });
  const searchRef = useRef<HTMLInputElement>(null);
  const [pane] = useState((): PaneApi => {
    const changed = () => {
      refreshUnwatched();
      refreshUndo();
      refreshPlaces();
      store.getState().bump();
    };
    const actions = createFileActions({
      store,
      granted,
      run: (label, work, where) =>
        runOperation(label, work, where, {
          started: (opId) => store.getState().setOp(opId),
          ended: (opId) => {
            if (store.getState().opId === opId) store.getState().setOp(null);
          },
        }),
      ask: () => dialogs.current,
      openDrive: (item) => driveOpen.current(item),
      changed,
      pick: pick
        ? (items) => pickRef.current?.onPick(items.filter((item) => !item.folder))
        : undefined,
    });
    return { store, granted, pick, actions, shown, order, searchRef };
  });
  const value = useMemo(() => ({ ...pane, pick }), [pane, pick]);
  useLoadPlaces(granted);

  const reveal = useFilesReveal();
  useEffect(() => {
    if (!reveal.path || !granted || pick) return;
    store
      .getState()
      .go({ kind: "disk", path: parentOf(reveal.path) }, { select: [reveal.path], root: true });
    useFilesReveal.setState({ path: null });
  }, [reveal.path, reveal.at, granted, pick, store]);

  const onDialogs = useCallback((next: FilesDialogs | null) => {
    dialogs.current = next;
  }, []);
  const trashFound = useCallback(
    async (paths: string[]) => {
      try {
        await disk.trash(paths);
      } catch (cause) {
        fail(cause, "Couldn't move it to the Trash.");
      } finally {
        refreshUnwatched();
        refreshUndo();
        store.getState().bump();
      }
    },
    [store],
  );

  return (
    <BrowserStoreContext.Provider value={store}>
      <PaneContext.Provider value={value}>
        <PaneBody slots={slots} footer={footer} onTransfers={onTransfers} driveOpen={driveOpen} />
        <FilesDialogsHost onReady={onDialogs} trash={trashFound} />
      </PaneContext.Provider>
    </BrowserStoreContext.Provider>
  );
}

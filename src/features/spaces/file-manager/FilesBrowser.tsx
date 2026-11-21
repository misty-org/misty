import { useRef, type ReactNode } from "react";
import { PropertyList, Text } from "@misty/ui";
import { useSpacesStore } from "../list/useSpacesStore";
import { enclosing, keyCommands, pathSegments } from "./browserParts";
import { ColumnsView } from "./ColumnsView";
import { collectionItem } from "./FileItems";
import { FilePreview } from "./FilePreview";
import { FilesBottomBar } from "./FilesBottomBar";
import { handleFilesKey, shownOrder } from "./filesKeys";
import { FilesMain, type BackgroundMenu } from "./FilesMain";
import { FilesSidebar } from "./FilesSidebar";
import { FilesToolbar } from "./FilesToolbar";
import { formatBytes, formatDate, kindOf } from "./format";
import { InfoPanel } from "./InfoPanel";
import { ItemMenu, type MenuContext } from "./ItemMenu";
import { browsable, localPath, placeFolder, placeInside, samePlace, type FileItem, type FilesPlace } from "./model";
import { QuickLook } from "./QuickLook";
import { useFilesBrowser, type FilesPick } from "./useFilesBrowser";

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
 * Files' browser, as Finder's window: the sidebar of places, the top bar, the open place as a list, a
 * grid or columns, Get info floating at the right, Quick Look, and the bottom bar. The Files page shows it
 * whole; the picker shows it with `pick`, where only what opens and shows is offered and the caller's
 * `footer` (its Open button) takes the bottom bar's place.
 */
export function FilesBrowser({
  granted,
  start,
  pick,
  footer,
}: {
  /** The disk grant is on; off, Files reaches the Space drives and the person's projects only. */
  granted: boolean;
  /** Where it opens. */
  start: FilesPlace;
  pick?: FilesPick;
  /** The picker's buttons, from what is picked now; `open` goes into a folder or picks a file. */
  footer?: (picked: FileItem[], open: (item: FileItem) => void) => ReactNode;
}) {
  const state = useFilesBrowser({ granted, start, pick });
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
  const commands = keyCommands(state, order, () => searchRef.current?.focus());
  const trashable =
    selectedItems.length > 0 && selectedItems.every((item) => ["disk", "project", "drive"].includes(item.source.kind));

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

  return (
    <div className="flex size-full min-h-0 min-w-0">
      <div className="w-56 shrink-0 overflow-y-auto px-2 py-3">
        <FilesSidebar
          current={place}
          granted={granted}
          picking={picking}
          places={places.places}
          tags={places.tags}
          agentTrash={places.agentTrash}
          macos={state.macos}
          onGo={(next) => state.go(next, { root: true })}
        />
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <FilesToolbar
          back={state.nav.back}
          forward={state.nav.forward}
          canBack={state.nav.canBack}
          canForward={state.nav.canForward}
          up={up ? () => state.go(up) : undefined}
          path={segments}
          create={changes && actions.canCreate ? actions.create : undefined}
          undo={changes && granted ? { label: state.undo.state.undo, run: () => void state.undo.undo() } : undefined}
          cut={commands.cut}
          copy={commands.copy}
          paste={changes && folder && actions.canPaste ? () => void actions.paste() : undefined}
          rename={commands.rename}
          trash={changes && trashable ? () => void actions.trash(selectedItems) : undefined}
          view={columnsShown ? "columns" : view === "columns" ? "list" : view}
          onView={state.setView}
          columns={browsable(place)}
          query={state.query}
          onQuery={state.setQuery}
          searchRef={searchRef}
          searchLabel={`Search ${title}`}
        />
        <FilesMain
          place={place}
          view={columnsShown ? "columns" : view}
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
        {state.info && one ? <InfoPanel key={one.id} item={one} onClose={() => state.setInfo(false)} /> : null}
        {pick && footer ? (
          footer(selectedItems, actions.open)
        ) : (
          <FilesBottomBar
            count={state.shown.status === "ready" ? items.length : null}
            selected={selectedItems.length}
            free={state.free}
            progress={state.operation.progress}
            onCancel={state.operation.cancel}
          />
        )}
      </div>
      {state.quick ? <QuickLook item={state.quick} onClose={() => state.setQuick(null)} /> : null}
      {state.dialogs}
    </div>
  );
}

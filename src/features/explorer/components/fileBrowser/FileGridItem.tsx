import type { FileBrowserProps } from "@/models/interfaces/features/explorer/components/FileBrowser";
import { memo, useMemo } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import type { ExplorerInlineEditState } from "@/stores/explorer";
import { transferDropAcceptance } from "../FileBrowserDrag";
import type { FileBrowserDragItem } from "@/models/types/features/explorer/components/FileBrowserDrag";
import { storageIdForPath } from "../../drag/operations";
import { useExplorerDragSource, useExplorerDropZone } from "../../drag/ExplorerDragContext";
import type {
  ExplorerDragModifiers,
  ExplorerDragPayload,
} from "@/models/interfaces/features/explorer/drag/types";
import { InlineNameEditor, PassiveRenameDraftView } from "../FileBrowserInline";
import type { PassiveRenameDraft } from "@/models/types/features/explorer/components/FileBrowserInline";
import { fileBrowserStyles } from "../FileBrowserStyles";
import { GridThumbnail } from "./GridThumbnail";

export const FileGridItem = memo(function FileGridItem(props: {
  entry: FileEntry;
  selectionOnly: boolean;
  thumbnailsEnabled: boolean;
  iconSize: number;
  style: CSSProperties;
  selected: boolean;
  cut: boolean;
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  onSelect: (entryId: string, event: MouseEvent) => void;
  onOpen: FileBrowserProps["onOpen"];
  onContextMenu: FileBrowserProps["onContextMenu"];
  dragItems: FileBrowserDragItem[];
  onDropItems: FileBrowserProps["onDropItems"];
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  const { entry } = props;
  const source = useExplorerDragSource(
    props.selectionOnly || entry.isDeleted ? [] : props.dragItems,
  );
  const dropSpec = useMemo(
    () => ({
      id: `entry:${entry.id}`,
      priority: 20,
      accepts: (payload: ExplorerDragPayload) =>
        transferDropAcceptance(payload, entry.path, {
          folder: entry.kind === "folder",
          writable: !entry.readonly && !entry.isDeleted,
        }),
      onDrop: (payload: ExplorerDragPayload, modifiers: ExplorerDragModifiers) =>
        props.onDropItems(
          payload,
          entry.path,
          storageIdForPath(entry.path, entry.location.remoteName),
          modifiers,
        ),
      onSpringLoad: entry.kind === "folder" ? () => props.onOpen(entry) : undefined,
      springLoad: entry.kind === "folder",
    }),
    [entry, props.onDropItems, props.onOpen],
  );
  const drop = useExplorerDropZone(dropSpec);

  return (
    <div
      ref={drop.ref}
      className={`${fileBrowserStyles.gridItem} ${props.selected ? fileBrowserStyles.gridItemSelected : ""} ${entry.isDeleted ? fileBrowserStyles.gridItemDeleted : ""} ${source.dragging ? fileBrowserStyles.gridItemDragging : ""} ${props.cut ? fileBrowserStyles.gridItemCut : ""}`}
      style={props.style}
      aria-disabled={entry.isDeleted || undefined}
      aria-pressed={props.selected}
      role="button"
      tabIndex={entry.isDeleted ? -1 : 0}
      onPointerDown={source.onPointerDown}
      onClick={(event) => props.onSelect(entry.id, event)}
      onDoubleClick={() => {
        if (!entry.isDeleted) props.onOpen(entry);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !entry.isDeleted) props.onOpen(entry);
      }}
      onContextMenu={
        props.selectionOnly
          ? (event) => event.preventDefault()
          : (event) => props.onContextMenu(event, entry)
      }
    >
      <GridThumbnail entry={entry} enabled={props.thumbnailsEnabled} iconSize={props.iconSize} />
      {props.inlineEdit ? (
        <InlineNameEditor
          edit={props.inlineEdit}
          variant="grid"
          onChange={props.onInlineEditChange}
          onCommit={props.onInlineEditCommit}
          onCancel={props.onInlineEditCancel}
        />
      ) : props.passiveRename ? (
        <PassiveRenameDraftView draft={props.passiveRename} />
      ) : (
        <span className={fileBrowserStyles.gridNameText}>{entry.name}</span>
      )}
    </div>
  );
});

import type { FileTableColumn } from "@/models/types/features/explorer/components/FileBrowser";
import type { FileBrowserProps } from "@/models/interfaces/features/explorer/components/FileBrowser";
import { TableCell, TableRow } from "@/ui";
import { memo, useMemo } from "react";
import type { MouseEvent } from "react";
import type { DirectorySizeRecord, FileEntry } from "@/models/interfaces/services/misty-api";
import type { ExplorerInlineEditState } from "@/stores/explorer";
import { formatDate } from "../../utils/fileFormat";
import { transferDropAcceptance } from "../FileBrowserDrag";
import type { FileBrowserDragItem } from "@/models/types/features/explorer/components/FileBrowserDrag";
import { storageIdForPath } from "../../drag/operations";
import { useExplorerDragSource, useExplorerDropZone } from "../../drag/ExplorerDragContext";
import type {
  ExplorerDragModifiers,
  ExplorerDragPayload,
} from "@/models/interfaces/features/explorer/drag/types";
import { FileIcon } from "../FileBrowserIcons";
import { InlineNameEditor, PassiveRenameDraftView } from "../FileBrowserInline";
import type { PassiveRenameDraft } from "@/models/types/features/explorer/components/FileBrowserInline";
import { fileBrowserStyles } from "../FileBrowserStyles";
import { formatEntrySize } from "./entryPresentation";

export const FileTableRow = memo(function FileTableRow(props: {
  entry: FileEntry;
  selectionOnly: boolean;
  columns: FileTableColumn[];
  hasFillerColumn: boolean;
  selected: boolean;
  cut: boolean;
  rowHeight: number;
  iconSize: number;
  onSelect: (entryId: string, event: MouseEvent) => void;
  onOpen: FileBrowserProps["onOpen"];
  onContextMenu: FileBrowserProps["onContextMenu"];
  dragItems: FileBrowserDragItem[];
  onDropItems: FileBrowserProps["onDropItems"];
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  directorySizes: Record<string, DirectorySizeRecord>;
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
    <TableRow
      ref={drop.ref}
      className={`${fileBrowserStyles.tableRow} ${props.inlineEdit ? fileBrowserStyles.tableRowInlineEditing : ""} ${entry.isDeleted ? fileBrowserStyles.tableRowDeleted : ""} ${source.dragging ? fileBrowserStyles.tableRowDragging : ""} ${props.cut ? fileBrowserStyles.tableRowCut : ""}`}
      style={{ height: props.rowHeight }}
      aria-disabled={entry.isDeleted || undefined}
      aria-selected={props.selected}
      data-state={props.selected ? "selected" : undefined}
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
      {props.columns.map((column) => (
        <FileTableCell
          key={column}
          column={column}
          entry={entry}
          rowHeight={props.rowHeight}
          iconSize={props.iconSize}
          inlineEdit={props.inlineEdit}
          passiveRename={props.passiveRename}
          directorySizes={props.directorySizes}
          onInlineEditChange={props.onInlineEditChange}
          onInlineEditCommit={props.onInlineEditCommit}
          onInlineEditCancel={props.onInlineEditCancel}
        />
      ))}
      {props.hasFillerColumn ? (
        <TableCell
          className={fileBrowserStyles.tableFillerCell}
          style={{ height: props.rowHeight }}
          aria-hidden="true"
        />
      ) : null}
    </TableRow>
  );
});

function FileTableCell(props: {
  column: FileTableColumn;
  entry: FileEntry;
  rowHeight: number;
  iconSize: number;
  inlineEdit: ExplorerInlineEditState | null;
  passiveRename: PassiveRenameDraft | null;
  directorySizes: Record<string, DirectorySizeRecord>;
  onInlineEditChange: FileBrowserProps["onInlineEditChange"];
  onInlineEditCommit: FileBrowserProps["onInlineEditCommit"];
  onInlineEditCancel: FileBrowserProps["onInlineEditCancel"];
}) {
  switch (props.column) {
    case "name":
      return (
        <TableCell
          className={`${fileBrowserStyles.tableNameCell} ${props.inlineEdit ? fileBrowserStyles.tableNameCellEditing : ""}`}
          style={{ height: props.rowHeight }}
        >
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <span className={fileBrowserStyles.tableIconSlot}>
              <FileIcon entry={props.entry} size={props.iconSize} variant="table" />
            </span>
            {props.inlineEdit ? (
              <InlineNameEditor
                edit={props.inlineEdit}
                variant="table"
                onChange={props.onInlineEditChange}
                onCommit={props.onInlineEditCommit}
                onCancel={props.onInlineEditCancel}
              />
            ) : props.passiveRename ? (
              <PassiveRenameDraftView draft={props.passiveRename} />
            ) : (
              <span className={fileBrowserStyles.tableNameText}>{props.entry.name}</span>
            )}
          </span>
        </TableCell>
      );
    case "modified":
      return (
        <TableCell
          className={`${fileBrowserStyles.tableCell} ${fileBrowserStyles.tableDateCell}`}
          style={{ height: props.rowHeight }}
        >
          {formatDate(props.entry.remoteModified ?? props.entry.modifiedMs)}
        </TableCell>
      );
    case "size":
      return (
        <TableCell
          className={`${fileBrowserStyles.tableCell} ${fileBrowserStyles.tableNumericCell}`}
          style={{ height: props.rowHeight }}
        >
          {formatEntrySize(props.entry, props.directorySizes)}
        </TableCell>
      );
    case "type":
      if (props.entry.isDeleted)
        return (
          <TableCell className={fileBrowserStyles.tableCell} style={{ height: props.rowHeight }}>
            Deleted
          </TableCell>
        );
      return (
        <TableCell className={fileBrowserStyles.tableCell} style={{ height: props.rowHeight }}>
          <span>
            {props.entry.kind === "folder"
              ? "Folder"
              : props.entry.mimeType || props.entry.extension || props.entry.kind}
          </span>
        </TableCell>
      );
  }
}

import type { FileEntry } from "@/native/ipc";
import { formatBytes, formatDate } from "@/shared/lib/fileFormat";
import { TableCell, TableRow } from "@/shared/ui";
import type { MouseEvent } from "react";
import { memo } from "react";
import { FileIcon } from "./FileIcons";
import type { FileListColumn } from "./fileListColumns";
import { fileListStyles } from "./fileListStyles";

export const FileListRow = memo(function FileListRow(props: {
  entry: FileEntry;
  columns: FileListColumn[];
  hasFillerColumn: boolean;
  selected: boolean;
  rowHeight: number;
  iconSize: number;
  onSelect: (entryId: string, event: MouseEvent) => void;
  onOpen: (entry: FileEntry) => void;
}) {
  const { entry } = props;
  return (
    <TableRow
      className={[
        fileListStyles.tableRow,
        entry.isDeleted ? fileListStyles.tableRowDeleted : "",
      ].join(" ")}
      style={{ height: props.rowHeight }}
      aria-disabled={entry.isDeleted || undefined}
      aria-selected={props.selected}
      data-state={props.selected ? "selected" : undefined}
      tabIndex={entry.isDeleted ? -1 : 0}
      onClick={(event) => props.onSelect(entry.id, event)}
      onDoubleClick={() => {
        if (!entry.isDeleted) props.onOpen(entry);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !entry.isDeleted) props.onOpen(entry);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {props.columns.map((column) => (
        <FileListCell
          key={column}
          column={column}
          entry={entry}
          rowHeight={props.rowHeight}
          iconSize={props.iconSize}
        />
      ))}
      {props.hasFillerColumn ? (
        <TableCell
          className={fileListStyles.tableFillerCell}
          style={{ height: props.rowHeight }}
          aria-hidden="true"
        />
      ) : null}
    </TableRow>
  );
});

function FileListCell(props: {
  column: FileListColumn;
  entry: FileEntry;
  rowHeight: number;
  iconSize: number;
}) {
  switch (props.column) {
    case "name":
      return (
        <TableCell className={fileListStyles.tableNameCell} style={{ height: props.rowHeight }}>
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <span className={fileListStyles.tableIconSlot}>
              <FileIcon entry={props.entry} size={props.iconSize} />
            </span>
            <span className={fileListStyles.tableNameText}>{props.entry.name}</span>
          </span>
        </TableCell>
      );
    case "modified":
      return (
        <TableCell
          className={`${fileListStyles.tableCell} ${fileListStyles.tableDateCell}`}
          style={{ height: props.rowHeight }}
        >
          {formatDate(props.entry.remoteModified ?? props.entry.modifiedMs)}
        </TableCell>
      );
    case "size":
      return (
        <TableCell
          className={`${fileListStyles.tableCell} ${fileListStyles.tableNumericCell}`}
          style={{ height: props.rowHeight }}
        >
          {/* Folder sizes are never walked here. */}
          {formatBytes(props.entry.kind === "folder" ? null : props.entry.sizeBytes)}
        </TableCell>
      );
    case "type":
      if (props.entry.isDeleted)
        return (
          <TableCell className={fileListStyles.tableCell} style={{ height: props.rowHeight }}>
            Deleted
          </TableCell>
        );
      return (
        <TableCell className={fileListStyles.tableCell} style={{ height: props.rowHeight }}>
          <span>
            {props.entry.kind === "folder"
              ? "Folder"
              : props.entry.mimeType || props.entry.extension || props.entry.kind}
          </span>
        </TableCell>
      );
  }
}

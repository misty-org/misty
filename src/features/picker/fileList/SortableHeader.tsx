import { Button, TableHead } from "@/shared/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { memo } from "react";
import type { FileListColumn, FileListSort } from "./fileListColumns";
import { fileListStyles } from "./fileListStyles";

/** A column header that toggles the sort, with a drag-to-resize handle. */
export const SortableHeader = memo(function SortableHeader(props: {
  label: string;
  column: FileListColumn;
  sort: FileListSort;
  resizing: boolean;
  onSort: (column: FileListColumn) => void;
  onResizeStart: (column: FileListColumn, event: ReactPointerEvent) => void;
}) {
  const active = props.sort.column === props.column;
  const direction = active ? props.sort.direction : null;
  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={`${fileListStyles.tableHeadCell} ${props.column === "size" ? fileListStyles.tableNumericHeader : ""}`}
    >
      <Button
        variant="ghost"
        size="sm"
        className={`${fileListStyles.tableSort} ${active ? fileListStyles.tableSortActive : ""}`}
        onClick={() => props.onSort(props.column)}
      >
        <span className={fileListStyles.tableSortLabel}>{props.label}</span>
        <span className={fileListStyles.tableSortIndicator}>
          {active ? (
            direction === "asc" ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            )
          ) : null}
        </span>
      </Button>
      <span
        className={`${fileListStyles.tableResizeHandle} ${props.resizing ? fileListStyles.tableResizeHandleActive : ""}`}
        aria-hidden="true"
        onPointerDown={(event) => props.onResizeStart(props.column, event)}
      />
    </TableHead>
  );
});

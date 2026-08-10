import { Button, TableHead } from "@/shared/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { memo } from "react";
import type { FileTableColumn } from "../../model/types/components/FileBrowser";
import type { ExplorerSortState } from "../../store";
import { fileBrowserStyles } from "../FileBrowserStyles";

/** A column header that toggles Explorer sort, with a drag-to-resize handle. */
export const SortableHeader = memo(function SortableHeader(props: {
  label: string;
  column: FileTableColumn;
  sort: ExplorerSortState;
  resizing: boolean;
  onSort: (column: FileTableColumn) => void;
  onResizeStart: (column: FileTableColumn, event: ReactPointerEvent) => void;
}) {
  const active = props.sort.column === props.column;
  const direction = active ? props.sort.direction : null;
  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={`${fileBrowserStyles.tableHeadCell} ${props.column === "size" ? fileBrowserStyles.tableNumericHeader : ""}`}
    >
      <Button
        variant="ghost"
        size="sm"
        className={`${fileBrowserStyles.tableSort} ${active ? fileBrowserStyles.tableSortActive : ""}`}
        onClick={() => props.onSort(props.column)}
      >
        <span className={fileBrowserStyles.tableSortLabel}>{props.label}</span>
        <span className={fileBrowserStyles.tableSortIndicator}>
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
        className={`${fileBrowserStyles.tableResizeHandle} ${props.resizing ? fileBrowserStyles.tableResizeHandleActive : ""}`}
        aria-hidden="true"
        onPointerDown={(event) => props.onResizeStart(props.column, event)}
      />
    </TableHead>
  );
});

import type { TransferTableActions } from "@/models/types/pages/Transfers/desktop/TransferTable";
export type { TransferTableActions } from "@/models/types/pages/Transfers/desktop/TransferTable";
import { memo, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { EmptyState } from "@/ui";
import { PrimitiveIconButton as IconButton } from "@/ui";
import { StatusBadge } from "@/ui";
import { Button } from "@/ui";
import { prettyLabel } from "@/lib/format";
import type {
  TransferSortDirection,
  TransferSortKey,
} from "@/models/types/stores/transfers/useTransfersStore";
import { relativeTime, remoteSummary } from "../transferUtils";
import { TransferRowActionsMenu, TransferRowContextMenu } from "./TransferMenus";
import type { TransferActionHandlers } from "@/models/types/pages/Transfers/desktop/TransferMenus";
import {
  canPauseResumeTransfer,
  isTransferTableColumn,
  primaryTransferLabel,
  secondaryTransferLabel,
  sortIndicator,
  transferColumnLabels,
  transferSortByColumn,
  transferStatusLabel,
  transferStatusTone,
  transferTime,
} from "./transferModel";
import type {
  TransferColumnWidths,
  TransferSortableKey,
  TransferTableColumn,
  TransferTreeRow,
} from "@/models/types/pages/Transfers/desktop/transferModel";
import { transferStyles } from "./transferStyles";

export function TransferHistoryTable(
  props: TransferTableActions & {
    rows: TransferTreeRow[];
    columnOrder: TransferTableColumn[];
    columnWidths: TransferColumnWidths;
    tableWidth: number;
    topSpacerHeight: number;
    bottomSpacerHeight: number;
    selectedIds: Set<number>;
    focusedTransferId: number | null;
    sortKey: TransferSortKey;
    sortDirection: TransferSortDirection;
    draggedColumn: TransferTableColumn | null;
    onSelect: (row: TransferRecord, event: ReactMouseEvent) => void;
    onFocus: (row: TransferRecord) => void;
    onToggleTree: (transferId: number) => void;
    onSort: (key: TransferSortableKey) => void;
    onResizeStart: (column: TransferTableColumn, event: ReactPointerEvent) => void;
    onDragStart: (column: TransferTableColumn) => void;
    onDragEnd: () => void;
    onColumnDrop: (source: TransferTableColumn, target: TransferTableColumn) => void;
  },
) {
  return (
    <>
      <table
        className={transferStyles.table}
        style={{ width: props.tableWidth, minWidth: "calc(100% - 12px)" }}
      >
        <caption className="sr-only">Transfer history</caption>
        <colgroup>
          {props.columnOrder.map((column) => (
            <col key={column} style={{ width: props.columnWidths[column] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {props.columnOrder.map((column) => (
              <TransferTableHeader
                key={column}
                column={column}
                label={transferColumnLabels[column]}
                sortKey={props.sortKey}
                sortDirection={props.sortDirection}
                dragging={props.draggedColumn === column}
                onSort={props.onSort}
                onResizeStart={props.onResizeStart}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
                onColumnDrop={props.onColumnDrop}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {props.topSpacerHeight > 0 ? (
            <SpacerRow height={props.topSpacerHeight} colSpan={props.columnOrder.length} />
          ) : null}
          {props.rows.map((entry) => (
            <TransferTableRow
              key={entry.row.id}
              {...props}
              row={entry.row}
              treeDepth={entry.depth}
              hasChildren={entry.hasChildren}
              expanded={entry.expanded}
              selected={props.selectedIds.has(entry.row.id)}
              focused={props.focusedTransferId === entry.row.id}
            />
          ))}
          {props.bottomSpacerHeight > 0 ? (
            <SpacerRow height={props.bottomSpacerHeight} colSpan={props.columnOrder.length} />
          ) : null}
        </tbody>
      </table>
      {props.rows.length === 0 && props.topSpacerHeight === 0 && props.bottomSpacerHeight === 0 ? (
        <EmptyState
          compact
          className="min-h-[calc(100%-33px)]"
          title={props.hasTransfers ? "No matching transfers" : "No transfer history"}
          description={
            props.hasTransfers
              ? "Adjust the search or filters to see more history."
              : "Uploads, downloads, and file operations will appear here."
          }
        />
      ) : null}
    </>
  );
}

const TransferTableHeader = memo(function TransferTableHeader(props: {
  column: TransferTableColumn;
  label: string;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  dragging: boolean;
  onSort: (key: TransferSortableKey) => void;
  onResizeStart: (column: TransferTableColumn, event: ReactPointerEvent) => void;
  onDragStart: (column: TransferTableColumn) => void;
  onDragEnd: () => void;
  onColumnDrop: (source: TransferTableColumn, target: TransferTableColumn) => void;
}) {
  const sort = transferSortByColumn[props.column];
  return (
    <th
      className={`${transferStyles.tableHeader} ${props.dragging ? transferStyles.tableHeaderDragging : ""}`}
      draggable
      aria-sort={
        sort && props.sortKey === sort
          ? props.sortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-misty-transfer-column", props.column);
        props.onDragStart(props.column);
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-misty-transfer-column")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        const source = event.dataTransfer.getData("application/x-misty-transfer-column");
        if (isTransferTableColumn(source)) {
          event.preventDefault();
          props.onColumnDrop(source, props.column);
        }
        props.onDragEnd();
      }}
    >
      {sort ? (
        <Button
          variant="ghost"
          size="sm"
          className={transferStyles.tableHeaderControl}
          onClick={() => props.onSort(sort)}
        >
          {props.label} {sortIndicator(props.sortKey, props.sortDirection, sort)}
        </Button>
      ) : (
        <span className={transferStyles.tableHeaderControl}>{props.label}</span>
      )}
      <span
        className={transferStyles.tableResizeHandle}
        aria-hidden="true"
        onPointerDown={(event) => props.onResizeStart(props.column, event)}
      />
    </th>
  );
});

const TransferTableRow = memo(function TransferTableRow(
  props: TransferTableActions & {
    row: TransferRecord;
    treeDepth: number;
    hasChildren: boolean;
    expanded: boolean;
    selected: boolean;
    focused: boolean;
    columnOrder: TransferTableColumn[];
    onSelect: (row: TransferRecord, event: ReactMouseEvent) => void;
    onFocus: (row: TransferRecord) => void;
    onToggleTree: (transferId: number) => void;
  },
) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const menuProps = {
    row: props.row,
    batchPaused: props.isBatchPaused(props.row),
    selectedCount: props.selectedCount,
    hasTransfers: props.hasTransfers,
    historyWorking: props.historyWorking,
    queueWorking: props.queueWorking,
    onPauseResume: props.onPauseResume,
    onPauseResumeBatch: props.onPauseResumeBatch,
    onCancelBatch: props.onCancelBatch,
    onResolveConflict: props.onResolveConflict,
    onCancel: props.onCancel,
    onRetry: props.onRetry,
    onUndo: props.onUndo,
    onDeleteRow: props.onDeleteRow,
    onDeleteSelected: props.onDeleteSelected,
    onDeleteAll: props.onDeleteAll,
  };
  const row = (
    <tr
      className={[
        transferStyles.tableRow,
        props.selected ? transferStyles.tableRowSelected : "",
        props.focused ? transferStyles.tableRowFocused : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-selected={props.selected}
      onClick={(event) => props.onSelect(props.row, event)}
      onContextMenu={() => props.onFocus(props.row)}
    >
      {props.columnOrder.map((column) => (
        <TransferTableCell
          key={column}
          {...props}
          {...menuProps}
          column={column}
          actionsVisible={dropdownOpen || contextOpen}
          onMenuOpenChange={(open) => {
            setDropdownOpen(open);
            if (open) props.onFocus(props.row);
          }}
        />
      ))}
    </tr>
  );
  return (
    <TransferRowContextMenu
      {...menuProps}
      onOpenChange={(open) => {
        setContextOpen(open);
        if (open) props.onFocus(props.row);
      }}
    >
      {row}
    </TransferRowContextMenu>
  );
});

const TransferTableCell = memo(function TransferTableCell(
  props: TransferTableActions & {
    column: TransferTableColumn;
    row: TransferRecord;
    treeDepth: number;
    hasChildren: boolean;
    expanded: boolean;
    actionsVisible: boolean;
    onToggleTree: (transferId: number) => void;
    onMenuOpenChange: (open: boolean) => void;
  },
) {
  if (props.column === "transfer") {
    return (
      <td className={transferStyles.tableCell}>
        <div
          className={transferStyles.nameCellContent}
          style={{ paddingLeft: Math.min(props.treeDepth, 6) * 16 }}
        >
          {props.hasChildren ? (
            <IconButton
              className={transferStyles.treeToggle}
              label={props.expanded ? "Collapse transfer" : "Expand transfer"}
              size="sm"
              tooltip={false}
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleTree(props.row.id);
              }}
            >
              {props.expanded ? <ChevronDown /> : <ChevronRight />}
            </IconButton>
          ) : (
            <span className={transferStyles.treeSpacer} aria-hidden="true" />
          )}
          <span className={transferStyles.nameText}>
            <strong className={transferStyles.tablePrimary}>
              {primaryTransferLabel(props.row)}
            </strong>
            <span className={transferStyles.tableSecondary}>
              J-{props.row.jobId} · {secondaryTransferLabel(props.row)}
            </span>
          </span>
        </div>
      </td>
    );
  }
  if (props.column === "operation")
    return <td className={transferStyles.tableCell}>{prettyLabel(props.row.transferType)}</td>;
  if (props.column === "status") {
    return (
      <td className={transferStyles.tableCell}>
        <StatusBadge status={transferStatusTone(props.row.status)} dot>
          {transferStatusLabel(props.row.status)}
        </StatusBadge>
      </td>
    );
  }
  if (props.column === "time")
    return <td className={transferStyles.tableCell}>{relativeTime(transferTime(props.row))}</td>;
  if (props.column === "remote")
    return <td className={transferStyles.tableCell}>{remoteSummary(props.row)}</td>;
  return (
    <td className={transferStyles.tableCell} onClick={(event) => event.stopPropagation()}>
      <div
        className={`${transferStyles.rowActions} ${props.actionsVisible ? transferStyles.rowActionsVisible : ""}`}
      >
        <div className={transferStyles.rowActionGroup} role="group" aria-label="Transfer actions">
          {props.row.operationId ? (
            <>
              <QuickAction
                label={props.row.paused ? "Resume transfer" : "Pause transfer"}
                disabled={!canPauseResumeTransfer(props.row) || props.queueWorking}
                onClick={() => void props.onPauseResume(props.row)}
              >
                {props.row.paused ? <Play /> : <Pause />}
              </QuickAction>
              <QuickAction
                label="Cancel transfer"
                disabled={!props.row.cancelable || props.queueWorking}
                onClick={() => void props.onCancel(props.row)}
              >
                <XCircle />
              </QuickAction>
              <QuickAction
                label="Retry transfer"
                disabled={
                  !props.row.retryable || props.row.status !== "failed" || props.queueWorking
                }
                onClick={() => void props.onRetry(props.row)}
              >
                <RotateCcw />
              </QuickAction>
            </>
          ) : props.row.retryable && props.row.status === "failed" ? (
            <QuickAction
              label="Retry transfer"
              disabled={props.queueWorking}
              onClick={() => void props.onRetry(props.row)}
            >
              <RotateCcw />
            </QuickAction>
          ) : null}
          <QuickAction
            label="Undo transfer"
            disabled={!props.row.undoable || !props.row.undoTokenId || props.queueWorking}
            onClick={() => props.onUndo(props.row.undoTokenId)}
          >
            <RefreshCcw />
          </QuickAction>
          <TransferRowActionsMenu
            {...props}
            row={props.row}
            batchPaused={props.isBatchPaused(props.row)}
            onOpenChange={props.onMenuOpenChange}
          />
        </div>
      </div>
    </td>
  );
});

function QuickAction(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <IconButton
      className={transferStyles.rowActionIconButton}
      label={props.label}
      size="sm"
      tooltip={false}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </IconButton>
  );
}

function SpacerRow(props: { height: number; colSpan: number }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={props.colSpan} style={{ height: props.height, padding: 0 }} />
    </tr>
  );
}

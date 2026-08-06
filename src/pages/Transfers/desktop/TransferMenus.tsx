import type {
  TransferActionHandlers,
  TransferActionMenuProps,
  TransferMenuEntry,
} from "@/models/types/pages/Transfers/desktop/TransferMenus";
export type {
  TransferActionHandlers,
  TransferActionMenuProps,
  TransferMenuEntry,
} from "@/models/types/pages/Transfers/desktop/TransferMenus";
import type { ReactElement, ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { IconButton } from "@/ui/icon-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import type {
  TransferSortDirection,
  TransferSortKey,
} from "@/models/types/stores/transfers/useTransfersStore";
import { canPauseResumeTransfer, transferSortOptions } from "./transferModel";
import type { TransferSortableKey } from "@/models/types/pages/Transfers/desktop/transferModel";
import { transferStyles } from "./transferStyles";

export function TransferSortMenu(props: {
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  onSort: (key: TransferSortableKey) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Sort transfers" size="sm" tooltip={false}>
          <ArrowUpDown />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 border-charcoal-border/70 shadow-md">
        <DropdownMenuLabel className="text-xs text-cream-muted">Sort transfers</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {transferSortOptions.map((option) => {
          const active = props.sortKey === option.key;
          const DirectionIcon = props.sortDirection === "asc" ? ArrowUp : ArrowDown;
          return (
            <DropdownMenuCheckboxItem
              key={option.key}
              checked={active}
              onSelect={(event) => {
                event.preventDefault();
                props.onSort(option.key);
              }}
            >
              <span>{option.label}</span>
              {active ? <DirectionIcon aria-hidden="true" className="ml-auto" /> : null}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TransferToolbarActions(props: TransferActionMenuProps) {
  const entries = buildTransferMenuEntries(props);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="More transfer actions" size="sm" tooltip={false}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 border-charcoal-border/70 shadow-md">
        <DropdownMenuLabel className="text-xs text-cream-muted">History actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownActionEntries entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TransferRowActionsMenu(
  props: TransferActionMenuProps & {
    onOpenChange?: (open: boolean) => void;
  },
) {
  const entries = buildTransferMenuEntries(props);
  return (
    <DropdownMenu onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <IconButton
          className={transferStyles.rowActionIconButton}
          label="More transfer actions"
          size="sm"
          tooltip={false}
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 border-charcoal-border/70 shadow-md">
        <DropdownActionEntries entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TransferRowContextMenu(
  props: TransferActionMenuProps & {
    children: ReactElement;
    onOpenChange?: (open: boolean) => void;
  },
) {
  const entries = buildTransferMenuEntries(props);
  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56 border-charcoal-border/70 shadow-md">
        <ContextActionEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DropdownActionEntries({ entries }: { entries: TransferMenuEntry[] }) {
  return entries.map((entry, index) =>
    entry.kind === "separator" ? (
      <DropdownMenuSeparator key={`separator-${index}`} />
    ) : (
      <DropdownMenuItem
        key={`${entry.label}-${index}`}
        disabled={entry.disabled}
        className={entry.danger ? "text-cream-bright focus:text-cream-bright" : undefined}
        onSelect={entry.run}
      >
        {entry.icon}
        {entry.label}
      </DropdownMenuItem>
    ),
  );
}

function ContextActionEntries({ entries }: { entries: TransferMenuEntry[] }) {
  return entries.map((entry, index) =>
    entry.kind === "separator" ? (
      <ContextMenuSeparator key={`separator-${index}`} />
    ) : (
      <ContextMenuItem
        key={`${entry.label}-${index}`}
        disabled={entry.disabled}
        className={entry.danger ? "gap-2 text-cream-bright focus:text-cream-bright" : "gap-2"}
        onSelect={entry.run}
      >
        {entry.icon}
        {entry.label}
      </ContextMenuItem>
    ),
  );
}

function buildTransferMenuEntries(props: TransferActionMenuProps): TransferMenuEntry[] {
  const entries: TransferMenuEntry[] = [];
  const pushItem = (entry: Omit<Extract<TransferMenuEntry, { kind: "item" }>, "kind">) => {
    entries.push({ kind: "item", ...entry });
  };
  const pushSeparator = () => {
    if (entries.length > 0 && entries[entries.length - 1]?.kind !== "separator")
      entries.push({ kind: "separator" });
  };
  const row = props.row;
  if (row?.operationId) {
    const canPauseResume = canPauseResumeTransfer(row) && !props.queueWorking;
    pushItem({
      label: row.paused ? "Resume" : "Pause",
      icon: row.paused ? <Play /> : <Pause />,
      disabled: !canPauseResume,
      run: () => void props.onPauseResume(row),
    });
    if (row.status === "waiting_for_resolution" && !props.queueWorking) {
      pushSeparator();
      if (row.supportsReplace)
        pushItem({
          label: "Replace",
          run: () => void props.onResolveConflict(row, "replace", false),
        });
      pushItem({ label: "Skip", run: () => void props.onResolveConflict(row, "skip", false) });
      if (row.supportsKeepBoth)
        pushItem({
          label: "Keep both",
          run: () => void props.onResolveConflict(row, "keep_both", false),
        });
      if (row.batchId) {
        pushSeparator();
        if (row.supportsReplace)
          pushItem({
            label: "Replace batch",
            run: () => void props.onResolveConflict(row, "replace", true),
          });
        pushItem({
          label: "Skip batch",
          run: () => void props.onResolveConflict(row, "skip", true),
        });
        if (row.supportsKeepBoth)
          pushItem({
            label: "Keep both in batch",
            run: () => void props.onResolveConflict(row, "keep_both", true),
          });
      }
    }
    pushSeparator();
    pushItem({
      label: "Cancel",
      icon: <XCircle />,
      disabled: !row.cancelable || props.queueWorking,
      run: () => void props.onCancel(row),
    });
    pushItem({
      label: "Retry",
      icon: <RotateCcw />,
      disabled: !row.retryable || row.status !== "failed" || props.queueWorking,
      run: () => void props.onRetry(row),
    });
    if (row.batchId) {
      pushSeparator();
      pushItem({
        label: props.batchPaused ? "Resume batch" : "Pause batch",
        icon: props.batchPaused ? <Play /> : <Pause />,
        disabled: props.queueWorking,
        run: () => void props.onPauseResumeBatch(row),
      });
      pushItem({
        label: "Cancel batch",
        icon: <XCircle />,
        disabled: props.queueWorking,
        run: () => void props.onCancelBatch(row),
      });
    }
  } else if (row?.retryable && row.status === "failed") {
    pushItem({
      label: "Retry",
      icon: <RotateCcw />,
      disabled: props.queueWorking,
      run: () => void props.onRetry(row),
    });
  }
  if (row && !row.operationId && row.undoable && row.undoTokenId) {
    pushSeparator();
    pushItem({
      label: "Undo",
      icon: <RefreshCcw />,
      disabled: props.queueWorking,
      run: () => props.onUndo(row.undoTokenId),
    });
  }
  if (row) {
    pushSeparator();
    pushItem({
      label: "Delete row",
      icon: <Trash2 />,
      danger: true,
      disabled: props.historyWorking,
      run: () => props.onDeleteRow(row.id),
    });
  }
  pushSeparator();
  pushItem({
    label: props.selectedCount > 0 ? `Delete selected (${props.selectedCount})` : "Delete selected",
    icon: <Trash2 />,
    danger: true,
    disabled: props.selectedCount === 0 || props.historyWorking,
    run: props.onDeleteSelected,
  });
  pushItem({
    label: "Clear all rows",
    icon: <Trash2 />,
    danger: true,
    disabled: !props.hasTransfers || props.historyWorking,
    run: props.onDeleteAll,
  });
  return entries;
}

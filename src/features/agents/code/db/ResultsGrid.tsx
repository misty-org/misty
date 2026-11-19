import { useVirtualizer } from "@tanstack/react-virtual";
import { Ban, Copy, Pencil, Undo2 } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import {
  CodeText,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  Input,
  MenuItem,
  OverflowFadeText,
  Skeleton,
  Surface,
  Text,
  notify,
} from "@/shared/ui";
import { uiPx } from "@/shared/lib/uiScale";
import type { CellValue, QueryResult } from "./dbApi";
import { cellText } from "./sqlText";

/** Every column is one width, so the header and the rows line up without measuring. */
const cellClass = "flex h-8 w-48 shrink-0 items-center px-2";
const indexClass = "flex h-8 w-14 shrink-0 items-center justify-end pr-3";

interface CellAt {
  row: number;
  column: string;
}

export interface ResultsGridProps {
  result: QueryResult;
  /** Changed cells not yet saved: row index, then column name, then the new value. */
  edits: Record<number, Record<string, CellValue>>;
  /** Cells can be changed: a table view of a table with a primary key, not mid-run. */
  editable: boolean;
  /** Whether a column takes NULL, from the table's schema. */
  nullable(column: string): boolean;
  onEdit(row: number, column: string, value: CellValue): void;
  onRevert(row: number, column: string): void;
}

function CellValueView({ value, changed }: { value: CellValue; changed: boolean }) {
  if (value === null) {
    return (
      <Text size="caption" tone={changed ? "changed" : "muted"}>
        NULL
      </Text>
    );
  }
  const text = cellText(value);
  // One line: a value's own line breaks would push the row out of its height.
  const line = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  return (
    <OverflowFadeText as="div" className="min-w-0 flex-1" full={line}>
      <CodeText size="caption" tone={changed ? "changed" : undefined} className="whitespace-pre">
        {line.replace(/\r?\n/g, "↵")}
      </CodeText>
    </OverflowFadeText>
  );
}

/** The field a cell turns into on a double-click. Enter or leaving keeps it; Escape doesn't. */
function CellEditor(props: { initial: string; onDone(value: string | null): void }) {
  const [draft, setDraft] = useState(props.initial);
  const finished = useRef(false);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    props.onDone(value);
  };
  return (
    <Input
      variant="compact"
      autoFocus
      aria-label="Cell value"
      value={draft}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(draft);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

/** Rows of a result, only the ones in view drawn. Double-click edits a cell when it can be. */
export function ResultsGrid(props: ResultsGridProps) {
  const { result, edits, editable } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<CellAt | null>(null);
  const [menuCell, setMenuCell] = useState<CellAt | null>(null);
  const virtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => uiPx(32),
    overscan: 12,
  });

  const valueAt = (cell: CellAt): CellValue => {
    const pending = edits[cell.row];
    if (pending && cell.column in pending) return pending[cell.column];
    const index = result.columns.findIndex((column) => column.name === cell.column);
    return result.rows[cell.row]?.[index] ?? null;
  };

  const cellFrom = (event: MouseEvent<HTMLElement>): CellAt | null => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cell-row]");
    if (!target) return null;
    return { row: Number(target.dataset.cellRow), column: target.dataset.cellColumn ?? "" };
  };

  const copy = (cell: CellAt) => {
    void navigator.clipboard
      .writeText(cellText(valueAt(cell)))
      .catch(() => notify({ tone: "error", message: "Couldn't copy to the clipboard." }));
  };

  const menuValue = menuCell ? valueAt(menuCell) : null;
  const menuPending = Boolean(
    menuCell && edits[menuCell.row] && menuCell.column in edits[menuCell.row],
  );

  return (
    <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
      <div className="w-max min-w-full">
        <Surface
          tone="page"
          className="sticky top-0 z-10 flex w-max min-w-full border-b"
          role="row"
        >
          <div className={indexClass} aria-hidden="true" />
          {result.columns.map((column, index) => (
            <div
              key={`${index}:${column.name}`}
              className={`${cellClass} gap-2`}
              role="columnheader"
            >
              <Text size="control" weight="medium" className="min-w-0 max-w-full" full>
                {column.name}
              </Text>
              {column.type ? (
                <Text size="caption" tone="muted" className="min-w-0 flex-1" full>
                  {column.type}
                </Text>
              ) : null}
            </div>
          ))}
        </Surface>
        <ContextMenu onOpenChange={(open) => !open && setMenuCell(null)}>
          <ContextMenuTrigger asChild>
            <div
              role="rowgroup"
              style={{ height: virtualizer.getTotalSize(), position: "relative" }}
              onContextMenu={(event) => {
                const cell = cellFrom(event);
                // Off a cell there's nothing to act on, and no menu.
                if (!cell) event.preventDefault();
                setMenuCell(cell);
              }}
              onDoubleClick={(event) => {
                const cell = cellFrom(event);
                if (cell && editable) setEditing(cell);
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const cells = result.rows[item.index] ?? [];
                const pending = edits[item.index];
                return (
                  <div
                    key={item.key}
                    role="row"
                    className="absolute top-0 left-0 flex w-max min-w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <Text size="caption" tone="muted" bare as="div" className={indexClass}>
                      {item.index + 1}
                    </Text>
                    {result.columns.map((column, index) => {
                      const changed = Boolean(pending && column.name in pending);
                      const value = changed ? pending![column.name] : (cells[index] ?? null);
                      const isEditing =
                        editing?.row === item.index && editing.column === column.name;
                      return (
                        <div
                          key={`${index}:${column.name}`}
                          role="gridcell"
                          className={cellClass}
                          data-cell-row={item.index}
                          data-cell-column={column.name}
                        >
                          {isEditing ? (
                            <CellEditor
                              initial={cellText(value)}
                              onDone={(text) => {
                                setEditing(null);
                                if (text !== null) props.onEdit(item.index, column.name, text);
                              }}
                            />
                          ) : (
                            <CellValueView value={value} changed={changed} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </ContextMenuTrigger>
          {/* Focus stays put, so a cell's field opened from here keeps it. */}
          <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
            {menuCell ? (
              <>
                <MenuItem icon={Copy} label="Copy value" onSelect={() => copy(menuCell)} />
                {editable ? (
                  <MenuItem
                    icon={Pencil}
                    label="Edit"
                    // After the menu has gone, so its closing doesn't take the field's focus.
                    onSelect={() => {
                      const cell = menuCell;
                      window.setTimeout(() => setEditing(cell), 0);
                    }}
                  />
                ) : null}
                {editable && props.nullable(menuCell.column) && menuValue !== null ? (
                  <MenuItem
                    icon={Ban}
                    label="Set to NULL"
                    onSelect={() => props.onEdit(menuCell.row, menuCell.column, null)}
                  />
                ) : null}
                {menuPending ? (
                  <MenuItem
                    icon={Undo2}
                    label="Revert"
                    onSelect={() => props.onRevert(menuCell.row, menuCell.column)}
                  />
                ) : null}
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </div>
  );
}

/** A result's first paint while its rows are read: the header band and rows of cells. */
export function ResultsSkeleton() {
  const widths = ["w-24", "w-32", "w-20", "w-28"];
  return (
    <div
      role="status"
      aria-label="Results"
      aria-busy="true"
      className="min-h-0 flex-1 overflow-hidden"
    >
      <div className="flex h-8 items-center border-b">
        <div className={indexClass} />
        {widths.map((width, index) => (
          <div key={index} className={cellClass}>
            <Skeleton className={`h-3 rounded-sm ${width}`} />
          </div>
        ))}
      </div>
      {Array.from({ length: 12 }, (_, row) => (
        <div key={row} className="flex h-8 items-center">
          <div className={indexClass} />
          {widths.map((_, index) => (
            <div key={index} className={cellClass}>
              <Skeleton className={`h-3 rounded-sm ${widths[(row + index) % widths.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

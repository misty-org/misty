import type * as Y from "yjs";
import { notify } from "@/shared/ui";
import type { WorkbookEngine } from "../formula/engine";
import { chartFromSelection, runOps, setColumnWidth, sortRows } from "../grid/gridEdits";
import { cellSelection } from "../grid/selection";
import { sheetRow, sheetRows, type SheetView } from "../grid/sheetView";
import { defaultColWidth } from "../workbook/schema";
import { usedExtent } from "../workbook/sheetEdit";
import { CellMenuRows, ColumnMenuRows } from "./GridMenus";
import type { GridController } from "./useGridController";
import { failed } from "./WorkbookActions";

/** Sheet rows as runs of neighbours, last first, so deleting each leaves the others in place. */
export function rowRuns(rows: readonly number[]): Array<{ start: number; count: number }> {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const runs: Array<{ start: number; count: number }> = [];
  for (const row of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.start + last.count === row) last.count += 1;
    else runs.push({ start: row, count: 1 });
  }
  return runs.reverse();
}

/**
 * The sheet's commands that change its shape: a chart from the selection, a column header's menu
 * and the cells' right-click menu, all as ops in one transaction each.
 */
export function useSheetCommands(props: {
  doc: Y.Doc;
  engine: WorkbookEngine;
  view: SheetView | null;
  canEdit: boolean;
  grid: GridController;
  onFilter(): void;
  onChartMade(chartId: string): void;
}) {
  const { doc, engine, view, canEdit, grid } = props;
  const { rect, selection } = grid;

  const run = (ops: Parameters<typeof runOps>[1]) => {
    try {
      runOps(doc, ops);
    } catch (error) {
      failed(error, "That didn't work. Try again.");
    }
  };

  const makeChart = () => {
    if (!view || !canEdit) return;
    let area = rect;
    if (rect.top === rect.bottom && rect.left === rect.right) {
      const index = engine.sheet(view.id);
      const used = index ? usedExtent({ cells: view.cells }, index) : { rows: 0, cols: 0 };
      if (!used.rows || !used.cols) {
        notify({ message: "Type some numbers first, then select them to chart." });
        return;
      }
      area = { top: 0, left: 0, bottom: used.rows - 1, right: used.cols - 1 };
    }
    try {
      const top = sheetRow(view, area.top);
      const bottom = sheetRow(view, area.bottom);
      props.onChartMade(
        chartFromSelection(doc, view.id, { top, bottom, left: area.left, right: area.right }),
      );
    } catch (error) {
      failed(error, "A chart couldn't be made from those cells.");
    }
  };

  const columnMenu = (col: number) => (
    <ColumnMenuRows
      canEdit={canEdit}
      width={view?.widths[col] ?? defaultColWidth}
      onSort={(direction) => {
        if (!view) return;
        try {
          sortRows(doc, engine, view.id, col, direction, Math.max(view.frozen, 1));
        } catch (error) {
          failed(error, "The rows couldn't be sorted.");
        }
      }}
      onFilter={() => {
        grid.setSelection(cellSelection(selection.anchor.row, col));
        props.onFilter();
      }}
      onInsert={(side) =>
        run([{ op: "insert_cols", sheet: view?.id, at: col + (side === "left" ? 1 : 2), count: 1 }])
      }
      onDelete={() => run([{ op: "delete_cols", sheet: view?.id, at: col + 1, count: 1 }])}
      onWidth={(width) => {
        const colId = view?.colIds[col];
        if (view && colId) setColumnWidth(doc, view.id, colId, width);
      }}
    />
  );

  const rows = view ? sheetRows(view, rect.top, rect.bottom - rect.top + 1) : [];
  const cols = rect.right - rect.left + 1;
  const cellMenu = (
    <CellMenuRows
      rows={rows.length}
      cols={cols}
      onInsertRows={(side) =>
        run([
          {
            op: "insert_rows",
            sheet: view?.id,
            at: (side === "above" ? rows[0] : rows[rows.length - 1] + 1) + 1,
            count: rows.length,
          },
        ])
      }
      onDeleteRows={() =>
        run(
          rowRuns(rows).map((runOf) => ({
            op: "delete_rows" as const,
            sheet: view?.id,
            at: runOf.start + 1,
            count: runOf.count,
          })),
        )
      }
      onInsertCols={(side) =>
        run([
          {
            op: "insert_cols",
            sheet: view?.id,
            at: (side === "left" ? rect.left : rect.right + 1) + 1,
            count: cols,
          },
        ])
      }
      onDeleteCols={() =>
        run([{ op: "delete_cols", sheet: view?.id, at: rect.left + 1, count: cols }])
      }
      onClear={grid.clear}
      onChart={makeChart}
    />
  );

  return { makeChart, columnMenu, cellMenu };
}

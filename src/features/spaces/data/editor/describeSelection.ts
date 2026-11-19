import type { WorkbookEngine } from "../formula/engine";
import type { Rect } from "../grid/selection";
import { sheetRows, type SheetView } from "../grid/sheetView";
import { formatA1Range } from "../workbook/a1";
import { plainValue } from "../workbook/values";

export interface SelectionDescription {
  sheet: string;
  /** The selection in A1, "B2:D9". */
  range: string;
  /** Its computed values, row by row, at most `selectionCellCap` of them. */
  values: Array<Array<string | number | boolean | null>>;
  truncated: boolean;
}

export const selectionCellCap = 200;

/** The selected cells as an agent reads them: where they are and what they hold. */
export function describeSelection(
  engine: WorkbookEngine,
  view: SheetView | null,
  rect: Rect,
): SelectionDescription | null {
  if (!view) return null;
  const right = Math.min(rect.right, view.colIds.length - 1);
  const width = Math.max(1, right - rect.left + 1);
  const height = rect.bottom - rect.top + 1;
  const rowsShown = Math.max(1, Math.min(height, Math.floor(selectionCellCap / width)));
  const cols = Math.min(width, selectionCellCap);
  const rows = sheetRows(view, rect.top, rowsShown);
  const values = rows.map((row) => {
    const line: Array<string | number | boolean | null> = [];
    for (let col = rect.left; col < rect.left + cols; col += 1) {
      const rowId = view.rowIds[row];
      const colId = view.colIds[col];
      line.push(rowId && colId ? plainValue(engine.value(view.id, rowId, colId)) : null);
    }
    return line;
  });
  const lastRow = sheetRows(view, rect.bottom, 1)[0];
  return {
    sheet: view.name,
    range: formatA1Range({
      start: { row: rows[0] ?? 0, col: rect.left },
      end: { row: lastRow, col: right },
    }),
    values,
    truncated: rowsShown < height || cols < width,
  };
}

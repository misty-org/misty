import * as Y from "yjs";
import { chartFromInput, type ChartInput } from "./charts";
import { newId } from "./ids";
import { addSheet, assertCellLimit, type WorkbookErrorReport } from "./ops";
import { defaultWorkbookCellLimit, maxCharts, maxSheets, type CellInput } from "./schema";
import { editContext, writeRows } from "./sheetEdit";
import { inputText } from "./values";
import { WorkbookEngine } from "../formula/engine";

export { applyWorkbookOps, runWorkbookOps, assertCellLimit } from "./ops";
export type { ApplyOptions, WorkbookApplyResult, WorkbookErrorReport, WorkbookOp } from "./ops";
export { readWorkbook } from "./read";
export type {
  PlainValue,
  WorkbookRangeRead,
  WorkbookReadArgs,
  WorkbookReadCell,
  WorkbookSheetSummary,
  WorkbookSummary,
} from "./read";
export type { ChartInput } from "./charts";

/** `workbook.create`'s input: sheets of rows (formulas as A1 text starting with "="), charts. */
export interface CreateWorkbookInput {
  title?: string;
  sheets?: Array<{ name: string; rows?: CellInput[][] }>;
  charts?: ChartInput[];
}

export interface CreateWorkbookResult {
  sheets: Array<{ id: string; name: string }>;
  chart_ids: string[];
  errors: WorkbookErrorReport[];
}

/**
 * Fills an empty workbook document in one transaction: its title, its sheets (every sheet made
 * before any is filled, so formulas can name sheets listed after them) and its charts. A workbook
 * with no sheets given gets one empty sheet.
 */
export function createWorkbook(
  doc: Y.Doc,
  input: CreateWorkbookInput,
  options?: { origin?: unknown; cellLimit?: number; firstSheetId?: string },
): CreateWorkbookResult {
  const sheets = input.sheets?.length ? input.sheets : [{ name: "Sheet 1", rows: [] }];
  if (sheets.length > maxSheets) throw new Error(`A workbook holds at most ${maxSheets} sheets.`);
  if ((input.charts?.length ?? 0) > maxCharts)
    throw new Error(`A workbook holds at most ${maxCharts} charts.`);
  const limit = options?.cellLimit ?? defaultWorkbookCellLimit;
  const filled = sheets.reduce(
    (total, sheet) =>
      total +
      (sheet.rows ?? []).reduce(
        (sum, row) => sum + (row ?? []).filter((cell) => inputText(cell)).length,
        0,
      ),
    0,
  );
  if (filled > limit)
    throw new Error(
      `That would make ${filled.toLocaleString("en-US")} filled cells; a workbook holds at most ${limit.toLocaleString("en-US")}.`,
    );
  if (editContext(doc).index.sheets.length) throw new Error("This workbook already has content.");
  // Tried on a copy first, so a chart that can't be made leaves the document untouched.
  const trial = new Y.Doc();
  fill(trial, input, sheets, options?.firstSheetId);
  trial.destroy();
  let result: { made: Array<{ id: string; name: string }>; chartIds: string[] } = {
    made: [],
    chartIds: [],
  };
  doc.transact(() => {
    result = fill(doc, input, sheets, options?.firstSheetId);
  }, options?.origin ?? "workbook-create");
  const { made, chartIds } = result;
  assertCellLimit(doc, limit);
  const errors = new WorkbookEngine(doc, { observe: false })
    .errors()
    .map(({ sheet, cell, error }) => ({ sheet, cell, error }));
  return { sheets: made, chart_ids: chartIds, errors };
}

function fill(
  doc: Y.Doc,
  input: CreateWorkbookInput,
  sheets: NonNullable<CreateWorkbookInput["sheets"]>,
  firstSheetId?: string,
): { made: Array<{ id: string; name: string }>; chartIds: string[] } {
  const context = editContext(doc);
  const made: Array<{ id: string; name: string }> = [];
  const chartIds: string[] = [];
  context.parts.meta.set("title", (input.title ?? "").trim() || "Untitled data");
  const rows = sheets.map((sheet) => (sheet.rows ?? []).map((line) => (line ?? []).map(inputText)));
  sheets.forEach((sheet, index) => {
    const width = rows[index].reduce((most, line) => Math.max(most, line.length), 0);
    const name = sheet.name || `Sheet ${index + 1}`;
    const id = addSheet(
      context,
      name,
      rows[index].length,
      width,
      index === 0 ? firstSheetId : undefined,
    );
    made.push({ id, name: context.index.byId.get(id)?.name ?? name });
  });
  made.forEach((sheet, index) => {
    if (rows[index].length) writeRows(context, sheet.id, 0, 0, rows[index]);
  });
  for (const chart of input.charts ?? []) {
    const id = newId();
    context.parts.charts.set(id, chartFromInput(context, chart));
    chartIds.push(id);
  }
  return { made, chartIds };
}

/**
 * A fresh workbook's starting content: one empty sheet. Its id is fixed, so two people opening a
 * new workbook at the same moment make the same sheet rather than two.
 */
export function seedEmptyWorkbook(doc: Y.Doc, title: string, origin?: unknown): void {
  if (editContext(doc).index.sheets.length) return;
  createWorkbook(doc, { title, sheets: [{ name: "Sheet 1" }] }, { origin, firstSheetId: "sheet1" });
}

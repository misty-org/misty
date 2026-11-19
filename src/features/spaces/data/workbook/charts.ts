import { columnLabel, parseA1Range, rangeBounds } from "./a1";
import { a1Formula, a1Range, anchorFormula, anchorRange, resolveAnchoredRange } from "./anchors";
import { columnAt, dropUndefined, partsOf, resolveSheet, type EditContext } from "./sheetEdit";
import { chartTypes, type ChartJSON, type ChartType } from "./schema";
import { literalValue } from "./values";
import type { SheetIndex } from "./workbookIndex";

/** A chart as agents and the chart popover describe it, in A1. */
export interface ChartInput {
  type: ChartType;
  title?: string;
  sheet?: string;
  /** The data, header row included: "A1:C13". */
  range?: string;
  /** The category column, as a letter ("A") or a range. */
  x?: string;
  /** The value columns, as letters ("B", "C") or ranges. */
  series?: string[];
  /** A stat tile's formula, "=SUM(B2:B13)". */
  formula?: string;
}

export function isChartType(value: unknown): value is ChartType {
  return typeof value === "string" && (chartTypes as readonly string[]).includes(value);
}

interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** One column of `box` as an anchored range on the sheet. */
function columnRange(context: EditContext, sheet: SheetIndex, box: Box, col: number): string {
  const text = anchorRange(
    sheet,
    { start: { row: box.top, col }, end: { row: box.bottom, col } },
    context.grow,
  );
  if (!text) throw new Error(`Column ${columnLabel(col)} is past the sheet's edge.`);
  return text;
}

/** "B" → that column within the chart's rows; "B2:B9" → that range. */
function columnRef(context: EditContext, sheet: SheetIndex, box: Box, ref: string): string {
  const col = columnAt(ref);
  if (col >= 0 && /^[A-Za-z]{1,3}$|^\d+$/.test(ref.trim()))
    return columnRange(context, sheet, box, col);
  const range = parseA1Range(ref);
  if (!range) throw new Error(`"${ref}" isn't a column or a range.`);
  const text = anchorRange(sheet, range, context.grow);
  if (!text) throw new Error(`"${ref}" is past the sheet's edge.`);
  return text;
}

/** Whether a column's cells under the header hold numbers, mostly. */
function numericColumn(context: EditContext, sheet: SheetIndex, box: Box, col: number): boolean {
  const cells = partsOf(context, sheet.id).cells;
  let numbers = 0;
  let filled = 0;
  for (let row = box.top + 1; row <= box.bottom; row += 1) {
    const input = cells.get(`${sheet.rowIds[row]}:${sheet.colIds[col]}`)?.v ?? "";
    if (!input) continue;
    filled += 1;
    if (input.startsWith("=") || typeof literalValue(input) === "number") numbers += 1;
  }
  return filled > 0 && numbers * 2 >= filled;
}

/**
 * A chart in its stored form. Without `x` and `series`, the first column is the categories (for
 * scatter, the x values) and every other numeric column a series.
 */
export function chartFromInput(context: EditContext, input: ChartInput): ChartJSON {
  if (!isChartType(input.type)) throw new Error(`"${String(input.type)}" isn't a chart type.`);
  const sheet = resolveSheet(context, input.sheet);
  const title = (input.title ?? "").trim().slice(0, 200);
  if (input.type === "stat") {
    if (!input.formula?.trim())
      throw new Error("A stat tile needs a formula, such as =SUM(B2:B13).");
    const formula = input.formula.trim().startsWith("=")
      ? input.formula.trim()
      : `=${input.formula.trim()}`;
    const range = input.range ? parseA1Range(input.range) : null;
    return dropUndefined({
      type: "stat",
      title,
      sheet: sheet.id,
      range: range ? (anchorRange(sheet, range, context.grow) ?? "") : "",
      series: [],
      formula: anchorFormula(formula, sheet.id, context.index, context.grow),
    });
  }
  if (!input.range) throw new Error("A chart needs a range, such as A1:C13.");
  const range = parseA1Range(input.range);
  if (!range) throw new Error(`"${input.range}" isn't a range.`);
  const box = rangeBounds(range, sheet.rowIds.length, sheet.colIds.length);
  const stored = anchorRange(sheet, range, context.grow);
  if (!stored) throw new Error(`"${input.range}" is past the sheet's edge.`);
  let x = input.x ? columnRef(context, sheet, box, input.x) : undefined;
  let series = (input.series ?? []).map((ref) => columnRef(context, sheet, box, ref));
  if (!input.x && !input.series?.length) {
    const firstNumeric = numericColumn(context, sheet, box, box.left);
    const categories = input.type === "scatter" || !firstNumeric || box.right > box.left;
    if (categories && box.right > box.left) x = columnRange(context, sheet, box, box.left);
    for (let col = x ? box.left + 1 : box.left; col <= box.right; col += 1)
      if (numericColumn(context, sheet, box, col))
        series.push(columnRange(context, sheet, box, col));
    if (!series.length && !x) series = [columnRange(context, sheet, box, box.left)];
  } else if (!input.x && box.right > box.left) {
    const first = columnRange(context, sheet, box, box.left);
    if (!series.includes(first)) x = first;
  }
  if (!series.length) throw new Error("The range has no column of numbers to chart.");
  return dropUndefined({ type: input.type, title, sheet: sheet.id, range: stored, x, series });
}

/** A stored chart back in A1, for agents and the popover. */
export function chartToInput(
  context: EditContext,
  chart: ChartJSON,
): ChartInput & { sheet: string } {
  const sheet = context.index.byId.get(chart.sheet);
  const name = sheet?.name ?? "#REF!";
  if (!sheet)
    return { type: chart.type, title: chart.title, sheet: name, range: "#REF!", series: [] };
  return dropUndefined({
    type: chart.type,
    title: chart.title,
    sheet: name,
    range: chart.range ? a1Range(chart.range, sheet) : undefined,
    x: chart.x ? a1Range(chart.x, sheet) : undefined,
    series: chart.series.map((series) => a1Range(series, sheet)),
    formula: chart.formula ? a1Formula(chart.formula, sheet.id, context.index) : undefined,
  });
}

/** Whether a stored range still points somewhere. */
export function rangeAlive(text: string, sheet: SheetIndex | undefined): boolean {
  return Boolean(sheet && resolveAnchoredRange(text, sheet));
}

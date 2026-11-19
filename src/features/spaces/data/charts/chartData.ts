import type { WorkbookEngine } from "../formula/engine";
import { resolveAnchoredRange } from "../workbook/anchors";
import type { ChartJSON, ChartType } from "../workbook/schema";
import {
  displayValue,
  isCellError,
  literalValue,
  numericValue,
  type CellValue,
} from "../workbook/values";

/** A chart's data as plain numbers, the shape the renderers and the PowerPoint exporter read. */
export interface ChartData {
  type: ChartType;
  title: string;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
  /** A stat tile's value, as the tile shows it. */
  display?: string;
  /** Why there is nothing to draw: the sheet or the range is gone. */
  problem?: "removed" | "empty";
}

/** The most points a chart draws; a longer range shows its first rows. */
export const maxChartPoints = 2000;

function isHeaderText(value: CellValue): boolean {
  return (
    typeof value === "string" && value.trim() !== "" && typeof literalValue(value) !== "number"
  );
}

export function chartData(engine: WorkbookEngine, chart: ChartJSON): ChartData {
  const base = { type: chart.type, title: chart.title };
  const sheet = engine.sheet(chart.sheet);
  if (!sheet) return { ...base, categories: [], series: [], problem: "removed" };

  if (chart.type === "stat") {
    const value = chart.formula ? engine.evaluate(chart.formula, chart.sheet) : null;
    const number = isCellError(value) ? null : numericValue(value);
    return {
      ...base,
      categories: [chart.title],
      series: [{ name: chart.title, values: [number] }],
      display: displayValue(
        value,
        number !== null && Math.abs(number) >= 1000 ? { num: "number", decimals: 0 } : undefined,
      ),
    };
  }

  const box = resolveAnchoredRange(chart.range, sheet);
  if (!box) return { ...base, categories: [], series: [], problem: "removed" };
  const columnOf = (text: string) => resolveAnchoredRange(text, sheet)?.left;
  const xCol = chart.x ? columnOf(chart.x) : undefined;
  const seriesCols = chart.series
    .map((text) => columnOf(text))
    .filter((col): col is number => col !== undefined);
  if (!seriesCols.length) return { ...base, categories: [], series: [], problem: "removed" };

  const valueAt = (row: number, col: number) =>
    engine.value(chart.sheet, sheet.rowIds[row], sheet.colIds[col]);
  const header = seriesCols.some((col) => isHeaderText(valueAt(box.top, col)));
  const first = header ? box.top + 1 : box.top;
  const last = Math.min(box.bottom, first + maxChartPoints - 1);
  const categories: string[] = [];
  const series = seriesCols.map((col, index) => ({
    name: header ? displayValue(valueAt(box.top, col)) : `Series ${index + 1}`,
    values: [] as Array<number | null>,
  }));
  for (let row = first; row <= last; row += 1) {
    const cells = seriesCols.map((col) => valueAt(row, col));
    const label = xCol === undefined ? null : valueAt(row, xCol);
    // A row with no category and no values (the empty rows under a table) isn't a point.
    if ((label === null || label === "") && cells.every((cell) => cell === null || cell === ""))
      continue;
    const format =
      xCol === undefined
        ? undefined
        : engine.cell(chart.sheet, sheet.rowIds[row], sheet.colIds[xCol])?.fmt;
    categories.push(xCol === undefined ? String(row - first + 1) : displayValue(label, format));
    cells.forEach((cell, index) => series[index].values.push(numericValue(cell)));
  }
  return {
    ...base,
    categories,
    series,
    ...(categories.length ? {} : { problem: "empty" as const }),
  };
}

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyWorkbookOps,
  createWorkbook,
  readWorkbook,
  seedEmptyWorkbook,
  type WorkbookRangeRead,
  type WorkbookSummary,
} from "./model";
import { chartsKey, dashboardKey, orderedSheets, sheetName, workbookParts } from "./schema";

function made() {
  const doc = new Y.Doc();
  const result = createWorkbook(doc, {
    title: "Sales",
    sheets: [
      {
        name: "Q1",
        rows: [
          ["Month", "Revenue", "Cost"],
          ["Jan", 100, 60],
          ["Feb", 120, 70],
          ["Mar", 150, 80],
          ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)"],
        ],
      },
      { name: "Summary", rows: [["Profit", "=Q1!B5-Q1!C5"]] },
    ],
    charts: [{ type: "column", title: "Revenue", sheet: "Q1", range: "A1:B4" }],
  });
  return { doc, result };
}

const range = (doc: Y.Doc, args: { sheet?: string; range: string }) =>
  readWorkbook(doc, args) as WorkbookRangeRead;
const summary = (doc: Y.Doc, args = {}) => readWorkbook(doc, args) as WorkbookSummary;

describe("workbook model", () => {
  it("creates sheets, formulas across sheets and charts in one go", () => {
    const { doc, result } = made();
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Q1", "Summary"]);
    expect(result.chart_ids).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(workbookParts(doc).meta.get("title")).toBe("Sales");
    expect(range(doc, { sheet: "Summary", range: "B1" }).cells).toEqual([
      [{ value: 160, formula: "='Q1'!B5-'Q1'!C5" }],
    ]);
  });

  it("summarizes without a range: sizes, header rows, charts and errors", () => {
    const { doc, result } = made();
    const read = summary(doc);
    expect(read.title).toBe("Sales");
    expect(read.sheets[0]).toMatchObject({
      name: "Q1",
      rows: 5,
      cols: 3,
      header: ["Month", "Revenue", "Cost"],
    });
    expect(read.charts[0]).toMatchObject({
      id: result.chart_ids[0],
      type: "column",
      title: "Revenue",
      sheet: "Q1",
      range: "A1:B4",
      x: "A1:A4",
      series: ["B1:B4"],
    });
    expect(read.errors).toEqual([]);
  });

  it("caps a range read at 2,000 cells", () => {
    const doc = new Y.Doc();
    const rows = Array.from({ length: 500 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => row * 10 + col),
    );
    createWorkbook(doc, { title: "Big", sheets: [{ name: "Data", rows }] });
    const read = range(doc, { range: "A1:J500" });
    expect(read.cells.length * read.cells[0].length).toBe(2000);
    expect(read.range).toBe("A1:J200");
    expect(read.truncated).toBe(true);
  });

  it("applies ops in one transaction and reports the errors they cause", () => {
    const { doc } = made();
    let transactions = 0;
    doc.on("afterTransaction", () => (transactions += 1));
    const result = applyWorkbookOps(doc, [
      { op: "set_range", sheet: "Q1", range: "D1", values: [["Margin"], ["=B2-C2"], ["=B3/0"]] },
      { op: "append_rows", sheet: "Q1", rows: [["Apr", 90, 50]] },
      { op: "add_sheet", name: "Notes", rows: [["=NOPE(1)"]] },
      { op: "rename_sheet", sheet: "Summary", name: "Overview" },
    ]);
    expect(transactions).toBe(1);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { sheet: "Q1", cell: "D3", error: "#DIV/0!" },
        { sheet: "Notes", cell: "A1", error: "#NAME?" },
      ]),
    );
    expect(range(doc, { sheet: "Q1", range: "A6:C6" }).cells[0].map((cell) => cell.value)).toEqual([
      "Apr",
      90,
      50,
    ]);
    expect(orderedSheets(doc).map((sheet) => sheetName(sheet.map))).toEqual([
      "Q1",
      "Overview",
      "Notes",
    ]);
    // A renamed sheet keeps every formula pointing at it.
    expect(range(doc, { sheet: "Overview", range: "B1" }).cells[0][0].formula).toBe(
      "='Q1'!B5-'Q1'!C5",
    );
  });

  it("inserts and deletes rows and columns; ranges shrink, lost cells read #REF!", () => {
    const { doc } = made();
    applyWorkbookOps(doc, [{ op: "insert_rows", sheet: "Q1", at: 3, rows: [["Dec", 10, 5]] }]);
    expect(range(doc, { sheet: "Q1", range: "B6" }).cells[0][0]).toEqual({
      value: 380,
      formula: "=SUM(B2:B5)",
    });
    const deleted = applyWorkbookOps(doc, [{ op: "delete_rows", sheet: "Q1", at: 5, count: 1 }]);
    expect(range(doc, { sheet: "Q1", range: "B5" }).cells[0][0]).toEqual({
      value: 230,
      formula: "=SUM(B2:B4)",
    });
    expect(deleted.errors).toEqual([]);
    applyWorkbookOps(doc, [{ op: "insert_cols", sheet: "Q1", at: "B", count: 1 }]);
    expect(range(doc, { sheet: "Q1", range: "C5" }).cells[0][0].formula).toBe("=SUM(C2:C4)");
    const lost = applyWorkbookOps(doc, [{ op: "delete_cols", sheet: "Q1", at: "C" }]);
    expect(lost.errors).toEqual(
      expect.arrayContaining([{ sheet: "Summary", cell: "B1", error: "#REF!" }]),
    );
  });

  it("adds, updates, pins and deletes charts", () => {
    const { doc } = made();
    const added = applyWorkbookOps(doc, [
      {
        op: "add_chart",
        chart: { type: "line", title: "Cost", sheet: "Q1", range: "A1:C4", series: ["C"] },
      },
      {
        op: "add_chart",
        chart: { type: "stat", title: "Total", sheet: "Q1", formula: "=SUM(B2:B4)" },
      },
    ]);
    expect(added.chart_ids).toHaveLength(2);
    const [line, stat] = added.chart_ids;
    applyWorkbookOps(doc, [
      { op: "update_chart", chart_id: line, chart: { type: "area", title: "Costs" } },
      { op: "pin_to_dashboard", chart_id: line },
      { op: "pin_to_dashboard", chart_id: stat },
      { op: "pin_to_dashboard", chart_id: stat },
    ]);
    const charts = doc.getMap(chartsKey);
    expect(charts.get(line)).toMatchObject({ type: "area", title: "Costs" });
    expect(doc.getArray(dashboardKey).toArray()).toEqual([{ chart: line }, { chart: stat }]);
    applyWorkbookOps(doc, [{ op: "delete_chart", chart_id: line }]);
    expect(charts.has(line)).toBe(false);
    expect(doc.getArray(dashboardKey).toArray()).toEqual([{ chart: stat }]);
  });

  it("leaves the workbook as it was when an op fails or the cell limit would pass", () => {
    const { doc } = made();
    const before = Y.encodeStateVector(doc);
    expect(() =>
      applyWorkbookOps(doc, [
        { op: "set_range", sheet: "Q1", range: "A10", values: [["kept?"]] },
        { op: "delete_sheet", sheet: "Nowhere" },
      ]),
    ).toThrow(/Op 2 \(delete_sheet\)/);
    expect(() =>
      applyWorkbookOps(
        doc,
        [{ op: "set_range", sheet: "Q1", range: "A20", values: [[1, 2, 3, 4, 5]] }],
        { cellLimit: 20 },
      ),
    ).toThrow(/at most 20/);
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it("refuses a workbook over the cell limit when creating it", () => {
    const doc = new Y.Doc();
    expect(() =>
      createWorkbook(
        doc,
        { title: "Huge", sheets: [{ name: "A", rows: [[1, 2, 3]] }] },
        { cellLimit: 2 },
      ),
    ).toThrow(/at most 2/);
    expect(orderedSheets(doc)).toHaveLength(0);
  });

  it("seeds a new workbook with one sheet, the same for two people at once", () => {
    const one = new Y.Doc();
    const two = new Y.Doc();
    seedEmptyWorkbook(one, "New");
    seedEmptyWorkbook(two, "New");
    Y.applyUpdate(one, Y.encodeStateAsUpdate(two));
    expect(orderedSheets(one)).toHaveLength(1);
  });
});

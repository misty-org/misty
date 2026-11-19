// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { exportSheetCsv, exportWorkbookXlsx } from "../export/workbookExport";
import {
  applyWorkbookOps,
  createWorkbook,
  readWorkbook,
  seedEmptyWorkbook,
  type WorkbookRangeRead,
} from "../workbook/model";
import { orderedSheets, sheetName, type CellJSON } from "../workbook/schema";
import { importKind, importWorkbookFile } from "./index";

const range = (doc: Y.Doc, sheet: string, cells: string) =>
  readWorkbook(doc, { sheet, range: cells }) as WorkbookRangeRead;

describe("import and export", () => {
  it("knows the files it opens", () => {
    expect(importKind({ name: "sales.CSV" })).toBe("csv");
    expect(importKind({ name: "log.tsv" })).toBe("tsv");
    expect(importKind({ name: "book.xlsx" })).toBe("xlsx");
    expect(importKind({ name: "notes.txt" })).toBeNull();
  });

  it("imports a CSV as one sheet, replacing the empty first sheet", async () => {
    const doc = new Y.Doc();
    seedEmptyWorkbook(doc, "New");
    const file = new File(['Name,Amount\n"Smith, J",12.5\nLee,=B2*2\n'], "people.csv", {
      type: "text/csv",
    });
    const summary = await importWorkbookFile(doc, file);
    expect(summary.sheets).toEqual([expect.objectContaining({ name: "people", rows: 3, cols: 2 })]);
    expect(orderedSheets(doc).map((sheet) => sheetName(sheet.map))).toEqual(["people"]);
    expect(range(doc, "people", "A2:B3").cells.map((row) => row.map((cell) => cell.value))).toEqual(
      [
        ["Smith, J", 12.5],
        ["Lee", 25],
      ],
    );
  });

  it("imports a TSV beside the sheets already there", async () => {
    const doc = new Y.Doc();
    createWorkbook(doc, { title: "Book", sheets: [{ name: "Main", rows: [["kept"]] }] });
    await importWorkbookFile(doc, new File(["a\tb\n1\t2\n"], "pairs.tsv"));
    expect(orderedSheets(doc).map((sheet) => sheetName(sheet.map))).toEqual(["Main", "pairs"]);
  });

  it("refuses a file that would pass the cell limit, writing nothing", async () => {
    const doc = new Y.Doc();
    seedEmptyWorkbook(doc, "New");
    const rows = Array.from({ length: 30 }, (_, row) => `${row},${row * 2}`).join("\n");
    await expect(
      importWorkbookFile(doc, new File([rows], "big.csv"), { cellLimit: 50 }),
    ).rejects.toThrow(/60 filled cells; a workbook holds at most 50/);
    expect(orderedSheets(doc).map((sheet) => sheetName(sheet.map))).toEqual(["Sheet 1"]);
  });

  it("round-trips Excel: values, formulas, sheet names, formats, widths and a frozen row", async () => {
    const doc = new Y.Doc();
    createWorkbook(doc, {
      title: "Budget",
      sheets: [
        {
          name: "Costs",
          rows: [
            ["Item", "Amount"],
            ["Rent", 1200],
            ["Food", 300.5],
            ["Total", "=SUM(B2:B3)"],
          ],
        },
        { name: "Plan B", rows: [["Share", "=Costs!B4/10"]] },
      ],
    });
    applyWorkbookOps(doc, [
      { op: "set_range", sheet: "Costs", range: "C1", values: [["Note"], ["paid"]] },
    ]);
    const costs = orderedSheets(doc)[0];
    doc.transact(() => {
      const amount = costs.cols.get(1);
      costs.colWidths.set(amount, 200);
      costs.map.set("frozenRows", 1);
      const key = `${costs.rows.get(1)}:${amount}`;
      costs.cells.set(key, {
        ...(costs.cells.get(key) as CellJSON),
        fmt: { num: "currency", bold: true },
      });
    });

    const blob = await exportWorkbookXlsx(doc);
    const back = new Y.Doc();
    await importWorkbookFile(back, new File([await blob.arrayBuffer()], "Budget.xlsx"));
    expect(orderedSheets(back).map((sheet) => sheetName(sheet.map))).toEqual(["Costs", "Plan B"]);
    expect(range(back, "Costs", "B4").cells[0][0]).toEqual({
      value: 1500.5,
      formula: "=SUM(B2:B3)",
    });
    expect(range(back, "Plan B", "B1").cells[0][0]).toEqual({
      value: 150.05,
      formula: "=Costs!B4/10",
    });
    const imported = orderedSheets(back)[0];
    expect(imported.map.get("frozenRows")).toBe(1);
    expect(imported.colWidths.get(imported.cols.get(1))).toBe(200);
    expect(
      imported.cells.get(`${imported.rows.get(1)}:${imported.cols.get(1)}`)?.fmt,
    ).toMatchObject({
      num: "currency",
      bold: true,
    });
  });

  it("exports a sheet as CSV as it shows", () => {
    const doc = new Y.Doc();
    createWorkbook(doc, {
      title: "T",
      sheets: [
        {
          name: "S",
          rows: [
            ["a, b", 2],
            ["=B1*2", "x"],
          ],
        },
      ],
    });
    expect(exportSheetCsv(doc, orderedSheets(doc)[0].id)).toBe('"a, b",2\r\n4,x');
  });
});

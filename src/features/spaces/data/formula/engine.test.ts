import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createWorkbook } from "../workbook/model";
import { orderedSheets } from "../workbook/schema";
import { anchorFormula } from "../workbook/anchors";
import { deleteRows, editContext, insertRows, setCellInput } from "../workbook/sheetEdit";
import { WorkbookEngine } from "./engine";

function workbook(
  rows: (string | number | boolean | null)[][],
  more?: Array<{ name: string; rows: (string | number | null)[][] }>,
) {
  const doc = new Y.Doc();
  createWorkbook(doc, { title: "Test", sheets: [{ name: "Main", rows }, ...(more ?? [])] });
  const engine = new WorkbookEngine(doc);
  const sheetId = orderedSheets(doc)[0].id;
  const at = (row: number, col: number, onSheet = sheetId) => engine.valueAt(onSheet, row, col);
  const set = (row: number, col: number, input: string) =>
    doc.transact(() => setCellInput(editContext(doc), sheetId, row, col, input));
  return { doc, engine, sheetId, at, set };
}

describe("formula engine", () => {
  it("computes arithmetic, comparisons and the v1 functions", () => {
    const { at } = workbook([
      [1, 2, 3, "apple"],
      [4, 5, 6, "pear"],
      [
        "=A1+B1*C1",
        "=SUM(A1:C2)",
        "=AVERAGE(A1:C1)",
        "=MAX(A1:C2)",
        "=MIN(A1:C2)",
        "=COUNT(A1:D2)",
        "=COUNTA(A1:D2)",
        "=A1<B1",
      ],
      [
        '=SUMIF(A1:A2,">1",B1:B2)',
        '=SUMIFS(C1:C2,A1:A2,">0",B1:B2,"<5")',
        '=COUNTIF(A1:C2,">2")',
        '=COUNTIFS(A1:A2,">0",D1:D2,"pear")',
        '=AVERAGEIF(A1:C2,">3")',
        '=IF(A1>0,"yes","no")',
        "=IFS(A1>5,1,A1>0,2)",
        "=AND(TRUE,A1=1)",
      ],
      [
        "=OR(FALSE,A2=4)",
        "=IFERROR(1/0,9)",
        "=ROUND(3.14159,2)",
        "=ABS(-3)",
        "=VLOOKUP(4,A1:C2,3,FALSE)",
        '=XLOOKUP("pear",D1:D2,A1:A2)',
        "=INDEX(A1:C2,2,3)",
        "=MATCH(5,B1:B2,0)",
      ],
      [
        '=TEXT(0.5,"0%")',
        '=CONCAT("a","b",1)',
        '=LEFT("hello",2)',
        '=RIGHT("hello",3)',
        '=LEN("hello")',
        '=UPPER("hi")',
        '=LOWER("HI")',
        '=TRIM("  x  ")',
      ],
      ["=DATE(2024,1,2)", "=TODAY()>45000", "=NOW()>45000"],
    ]);
    expect([
      at(2, 0),
      at(2, 1),
      at(2, 2),
      at(2, 3),
      at(2, 4),
      at(2, 5),
      at(2, 6),
      at(2, 7),
    ]).toEqual([7, 21, 2, 6, 1, 6, 8, true]);
    expect([
      at(3, 0),
      at(3, 1),
      at(3, 2),
      at(3, 3),
      at(3, 4),
      at(3, 5),
      at(3, 6),
      at(3, 7),
    ]).toEqual([5, 3, 4, 1, 5, "yes", 2, true]);
    expect([
      at(4, 0),
      at(4, 1),
      at(4, 2),
      at(4, 3),
      at(4, 4),
      at(4, 5),
      at(4, 6),
      at(4, 7),
    ]).toEqual([true, 9, 3.14, 3, 6, 4, 6, 2]);
    expect([
      at(5, 0),
      at(5, 1),
      at(5, 2),
      at(5, 3),
      at(5, 4),
      at(5, 5),
      at(5, 6),
      at(5, 7),
    ]).toEqual(["50%", "ab1", "he", "llo", 5, "HI", "hi", "x"]);
    expect([at(6, 0), at(6, 1), at(6, 2)]).toEqual([45293, true, true]);
  });

  it("reports errors by their codes", () => {
    const { at } = workbook([[1, "text", "=FOO(1)", "=1/0", "=B1+1", "=A1"]]);
    expect(at(0, 2)).toEqual({ error: "#NAME?" });
    expect(at(0, 3)).toEqual({ error: "#DIV/0!" });
    expect(at(0, 4)).toEqual({ error: "#VALUE!" });
    expect(at(0, 5)).toBe(1);
  });

  it("marks every cell of a cycle", () => {
    const { at } = workbook([["=B1+1", "=C1+1", "=A1+1", "=A1"]]);
    expect(at(0, 0)).toEqual({ error: "#CYCLE!" });
    expect(at(0, 1)).toEqual({ error: "#CYCLE!" });
    expect(at(0, 2)).toEqual({ error: "#CYCLE!" });
    expect(at(0, 3)).toEqual({ error: "#CYCLE!" });
  });

  it("reads other sheets by name", () => {
    const { at } = workbook(
      [["=SUM(Data!A1:A3)", "='Data'!B1&\"!\""]],
      [{ name: "Data", rows: [[1, "x"], [2], [3]] }],
    );
    expect(at(0, 0)).toBe(6);
    expect(at(0, 1)).toBe("x!");
  });

  it("recomputes what reads a change, through single cells and ranges", () => {
    const { at, set, engine } = workbook([[1, "=A1*2", "=SUM(A1:A3)", "=B1+C1"], [2], [3]]);
    expect(at(0, 3)).toBe(8);
    const changes: Array<Set<string> | "all"> = [];
    engine.subscribe((change) => changes.push(change.cells));
    set(1, 0, "10");
    expect(at(0, 2)).toBe(14);
    expect(at(0, 3)).toBe(16);
    expect(changes).toHaveLength(1);
    const dirty = changes[0];
    expect(dirty).not.toBe("all");
    // A2, the SUM over it and what reads the SUM; B1 doesn't read A2 and keeps its value.
    expect((dirty as Set<string>).size).toBe(3);
    set(0, 0, "5");
    expect(at(0, 1)).toBe(10);
    expect(at(0, 3)).toBe(28);
  });

  it("follows inserted rows and shows #REF! for a deleted one", () => {
    const { doc, at, sheetId } = workbook([[1, "=A2"], [2], [3, "=SUM(A1:A3)"]]);
    doc.transact(() => insertRows(editContext(doc), sheetId, 1, 1));
    expect(at(0, 1)).toBe(2);
    expect(at(3, 1)).toBe(6);
    doc.transact(() => deleteRows(editContext(doc), sheetId, 2, 1));
    expect(at(0, 1)).toEqual({ error: "#REF!" });
    expect(at(2, 1)).toBe(4);
  });

  it("computes a long chain without overflowing the stack", () => {
    const rows: (string | number)[][] = [[1]];
    for (let row = 1; row < 5000; row += 1) rows.push([`=A${row}+1`]);
    const { at } = workbook(rows);
    expect(at(4999, 0)).toBe(5000);
  });

  it("evaluates a stat tile's formula on its sheet", () => {
    const { engine, sheetId } = workbook([[2], [3]]);
    const stored = anchorFormula("=SUM(A1:A2)", sheetId, engine.workbookIndex);
    expect(engine.evaluate(stored, sheetId)).toBe(5);
  });
});

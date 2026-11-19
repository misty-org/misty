import { describe, expect, it } from "vitest";
import {
  cellName,
  columnIndex,
  columnLabel,
  formatA1Range,
  formulaSheetName,
  parseA1Range,
  scanA1References,
  shiftA1Formula,
} from "./a1";

describe("A1 names", () => {
  it("turns column indexes into letters and back", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(columnLabel(701)).toBe("ZZ");
    expect(columnLabel(702)).toBe("AAA");
    for (const index of [0, 1, 25, 26, 51, 52, 701, 702, 18277])
      expect(columnIndex(columnLabel(index))).toBe(index);
    expect(columnIndex("aa")).toBe(26);
    expect(columnIndex("ABCD")).toBe(-1);
    expect(cellName(4, 2)).toBe("C5");
  });

  it("parses cells, ranges, whole columns and rows, with sheet names", () => {
    expect(parseA1Range("B2")).toEqual({
      sheet: undefined,
      start: { row: 1, col: 1, absRow: false, absCol: false },
      end: { row: 1, col: 1, absRow: false, absCol: false },
    });
    expect(parseA1Range("$A$1:C10")?.start).toEqual({ row: 0, col: 0, absRow: true, absCol: true });
    expect(parseA1Range("A:C")?.end).toEqual({ col: 2, absCol: false });
    expect(parseA1Range("3:5")?.start).toEqual({ row: 2, absRow: false });
    expect(parseA1Range("'My data'!A1:B2")?.sheet).toBe("My data");
    expect(parseA1Range("Sheet2!B:B")?.sheet).toBe("Sheet2");
    expect(parseA1Range("A1:B")).toBeNull();
    expect(parseA1Range("A")).toBeNull();
    expect(parseA1Range("hello")).toBeNull();
  });

  it("writes ranges back, quoting sheet names that need it", () => {
    expect(formatA1Range({ start: { row: 0, col: 0 }, end: { row: 9, col: 2 } })).toBe("A1:C10");
    expect(formatA1Range({ start: { row: 4, col: 1 }, end: { row: 4, col: 1 } })).toBe("B5");
    expect(formulaSheetName("Data")).toBe("Data");
    expect(formulaSheetName("My data")).toBe("'My data'");
    expect(formulaSheetName("A1")).toBe("'A1'");
  });

  it("finds references in a formula, skipping strings and function names", () => {
    const tokens = scanA1References("=SUM(A1:B2)+LOG10(C3)&\"D4\"+'Q4 sales'!E5+Data!F:F+$G$7");
    expect(tokens.map((token) => token.range.sheet ?? "")).toEqual([
      "",
      "",
      "Q4 sales",
      "Data",
      "",
    ]);
    expect(tokens.map((token) => token.single)).toEqual([false, true, true, false, true]);
    expect(scanA1References("=ATAN2(1,2)+DEC2BIN(3)")).toHaveLength(0);
    expect(scanA1References('="A1 is text"')).toHaveLength(0);
  });

  it("moves relative references and keeps absolute ones", () => {
    expect(shiftA1Formula("=A1+$B$1+C$1+$D1", 2, 1)).toBe("=B3+$B$1+D$1+$D3");
    expect(shiftA1Formula("=SUM(A1:A3)", 1, 0)).toBe("=SUM(A2:A4)");
    expect(shiftA1Formula("=A1", -1, 0)).toBe("=#REF!");
    expect(shiftA1Formula("=Data!A1", 1, 0)).toBe("=Data!A2");
  });
});

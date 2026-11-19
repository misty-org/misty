import { describe, expect, it } from "vitest";
import { a1Formula, anchorFormula, scanAnchors, shiftFormula } from "./anchors";
import { indexFromSheets, type SheetIndex } from "./workbookIndex";

function sheet(id: string, name: string, rows: number, cols: number): SheetIndex {
  const rowIds = Array.from({ length: rows }, (_, index) => `${id}r${index}`);
  const colIds = Array.from({ length: cols }, (_, index) => `${id}c${index}`);
  return {
    id,
    name,
    rowIds,
    colIds,
    rowAt: new Map(rowIds.map((rowId, index) => [rowId, index])),
    colAt: new Map(colIds.map((colId, index) => [colId, index])),
  };
}

describe("id-anchored formulas", () => {
  const main = sheet("s1", "Main", 10, 5);
  const data = sheet("s2", "Q4 data", 10, 5);
  const index = indexFromSheets([main, data]);

  it("stores references by row and column id and reads them back as A1", () => {
    const stored = anchorFormula("=SUM(A1:B3)+C2*'Q4 data'!D4", "s1", index);
    expect(stored).toBe(
      "=SUM({r:s1r0,c:s1c0}:{r:s1r2,c:s1c1})+{r:s1r1,c:s1c2}*{s:s2,r:s2r3,c:s2c3}",
    );
    expect(a1Formula(stored, "s1", index)).toBe("=SUM(A1:B3)+C2*'Q4 data'!D4");
  });

  it("keeps absolute markers, whole columns and string literals", () => {
    const stored = anchorFormula('=$A$1+B$2+SUM(C:C)&"A1"', "s1", index);
    expect(stored).toContain("{r:s1r0,c:s1c0,a:rc}");
    expect(stored).toContain("{r:s1r1,c:s1c1,a:r}");
    expect(stored).toContain("{c:s1c2}:{c:s1c2}");
    expect(stored).toContain('"A1"');
    expect(a1Formula(stored, "s1", index)).toBe('=$A$1+B$2+SUM(C:C)&"A1"');
  });

  it("follows rows as they move, and reads #REF! once a row is gone", () => {
    const stored = anchorFormula("=A3+B5", "s1", index);
    const moved = indexFromSheets([
      {
        ...main,
        rowIds: ["new", ...main.rowIds],
        rowAt: new Map(["new", ...main.rowIds].map((id, at) => [id, at])),
      },
      data,
    ]);
    expect(a1Formula(stored, "s1", moved)).toBe("=A4+B6");
    const gone = main.rowIds.filter((id) => id !== "s1r2");
    const without = indexFromSheets([
      { ...main, rowIds: gone, rowAt: new Map(gone.map((id, at) => [id, at])) },
      data,
    ]);
    expect(a1Formula(stored, "s1", without)).toBe("=#REF!+B4");
  });

  it("refuses references past the sheet unless it may grow, and unknown sheets", () => {
    expect(anchorFormula("=Z99", "s1", index)).toBe("=#REF!");
    expect(anchorFormula("=Nowhere!A1", "s1", index)).toBe("=#REF!");
    const grown: string[] = [];
    const small = sheet("s3", "Small", 2, 2);
    const own = indexFromSheets([small]);
    const stored = anchorFormula("=C4", "s3", own, (target, rows, cols) => {
      while (target.rowIds.length < rows) {
        const id = `g${target.rowIds.length}`;
        target.rowAt.set(id, target.rowIds.length);
        target.rowIds.push(id);
        grown.push(id);
      }
      while (target.colIds.length < cols) {
        const id = `h${target.colIds.length}`;
        target.colAt.set(id, target.colIds.length);
        target.colIds.push(id);
      }
    });
    expect(grown).toEqual(["g2", "g3"]);
    expect(stored).toBe("={r:g3,c:h2}");
  });

  it("moves anchored formulas for fill, keeping absolute parts", () => {
    const stored = anchorFormula("=A1*$B$1", "s1", index);
    expect(a1Formula(shiftFormula(stored, "s1", index, 3, 0), "s1", index)).toBe("=A4*$B$1");
  });

  it("finds anchors outside string literals only", () => {
    expect(scanAnchors('="{r:a,c:b}"&{r:x,c:y}')).toHaveLength(1);
    expect(scanAnchors("=SUM({1,2,3})")).toHaveLength(0);
  });
});

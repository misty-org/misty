import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { WorkbookEngine } from "../formula/engine";
import { createWorkbook, readWorkbook, type WorkbookRangeRead } from "../workbook/model";
import { orderedSheets } from "../workbook/schema";
import { parseTsv, toHtmlTable, toTsv } from "./clipboard";
import { CellLimitError, fillCells, pasteCells, sortRows } from "./gridEdits";
import {
  cellSelection,
  editKeyAction,
  gridKeyAction,
  moveSelection,
  rectOf,
  type GridKeyAction,
} from "./selection";

const bounds = { rows: 100, cols: 26 };
const key = (
  key: string,
  extra: Partial<{ shiftKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => gridKeyAction({ key, ...extra });

describe("grid keyboard", () => {
  it("maps keys the way spreadsheets do", () => {
    expect(key("ArrowDown")).toEqual({
      type: "move",
      direction: "down",
      extend: false,
      jump: false,
    });
    expect(key("ArrowRight", { shiftKey: true })).toMatchObject({ extend: true });
    expect(key("ArrowUp", { metaKey: true })).toMatchObject({ jump: true });
    expect(key("Enter")).toEqual({ type: "step", direction: "down" });
    expect(key("Enter", { shiftKey: true })).toEqual({ type: "step", direction: "up" });
    expect(key("Tab")).toEqual({ type: "step", direction: "right" });
    expect(key("F2")).toEqual({ type: "edit" });
    expect(key("Delete")).toEqual({ type: "clear" });
    expect(key("Backspace")).toEqual({ type: "clear" });
    expect(key("x")).toEqual({ type: "type", text: "x" });
    expect(key("=")).toEqual({ type: "type", text: "=" });
    const commands: Array<[string, GridKeyAction["type"]]> = [
      ["d", "fillDown"],
      ["z", "undo"],
      ["b", "bold"],
      ["f", "find"],
      ["a", "selectAll"],
    ];
    for (const [letter, type] of commands) expect(key(letter, { metaKey: true })?.type).toBe(type);
    expect(key("z", { metaKey: true, shiftKey: true })?.type).toBe("redo");
    expect(key("Shift")).toBeNull();
  });

  it("moves, extends and jumps within the sheet", () => {
    const start = cellSelection(5, 5);
    expect(moveSelection(start, "up", {}, bounds).anchor).toEqual({ row: 4, col: 5 });
    const wide = moveSelection(
      moveSelection(start, "right", { extend: true }, bounds),
      "down",
      { extend: true },
      bounds,
    );
    expect(rectOf(wide)).toEqual({ top: 5, left: 5, bottom: 6, right: 6 });
    expect(moveSelection(start, "down", { jump: true }, bounds).anchor).toEqual({
      row: 99,
      col: 5,
    });
    expect(moveSelection(cellSelection(0, 0), "left", {}, bounds).anchor).toEqual({
      row: 0,
      col: 0,
    });
    expect(moveSelection(start, "down", { by: 20 }, bounds).anchor).toEqual({ row: 25, col: 5 });
  });

  it("commits an edit on Enter and Tab, and on arrows only when typing replaced the cell", () => {
    expect(editKeyAction({ key: "Enter" }, "edit")).toEqual({ type: "commit", direction: "down" });
    expect(editKeyAction({ key: "Tab", shiftKey: true }, "edit")).toEqual({
      type: "commit",
      direction: "left",
    });
    expect(editKeyAction({ key: "Escape" }, "enter")).toEqual({ type: "cancel" });
    expect(editKeyAction({ key: "ArrowLeft" }, "enter")).toEqual({
      type: "commit",
      direction: "left",
    });
    expect(editKeyAction({ key: "ArrowLeft" }, "edit")).toBeNull();
  });
});

describe("clipboard", () => {
  it("writes and reads TSV the way Excel and Sheets do", () => {
    const rows = [
      ["a", "b\tc"],
      ['say "hi"', "line\nbreak"],
    ];
    expect(toTsv(rows)).toBe('a\t"b\tc"\n"say ""hi"""\t"line\nbreak"');
    expect(parseTsv(toTsv(rows))).toEqual(rows);
    expect(parseTsv("1\t2\r\n3\t4\r\n")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseTsv("just one")).toEqual([["just one"]]);
    expect(toHtmlTable([["<b>"]])).toContain("<td>&lt;b&gt;</td>");
  });
});

describe("grid edits", () => {
  function book(rows: (string | number)[][]) {
    const doc = new Y.Doc();
    createWorkbook(doc, { title: "Grid", sheets: [{ name: "S", rows }] });
    const sheetId = orderedSheets(doc)[0].id;
    const read = (range: string) =>
      (readWorkbook(doc, { range }) as WorkbookRangeRead).cells.map((row) =>
        row.map((cell) => cell.formula ?? cell.value),
      );
    return { doc, sheetId, read };
  }

  it("pastes text, and refuses a paste past the cell limit", () => {
    const { doc, sheetId, read } = book([[1]]);
    pasteCells(doc, sheetId, [1, 2], 0, {
      kind: "text",
      rows: [
        ["2", "=A1+A2"],
        ["3", "x"],
      ],
    });
    expect(read("A2:B3")).toEqual([
      [2, "=A1+A2"],
      [3, "x"],
    ]);
    expect(() =>
      pasteCells(doc, sheetId, [5], 0, { kind: "text", rows: [["a", "b", "c"]] }, 6),
    ).toThrow(CellLimitError);
    expect(read("A6:C6")).toEqual([[null, null, null]]);
  });

  it("pastes copied formulas moved to where they land", () => {
    const { doc, sheetId, read } = book([[1, 2, "=A1+B1"]]);
    const sheet = orderedSheets(doc)[0];
    const stored = sheet.cells.get(`${sheet.rows.get(0)}:${sheet.cols.get(2)}`)!;
    pasteCells(doc, sheetId, [3], 2, {
      kind: "workbook",
      clip: { doc: doc.guid, sheet: sheetId, row: 0, col: 2, cells: [[{ v: stored.v }]] },
    });
    expect(read("C4")).toEqual([["=A4+B4"]]);
  });

  it("fills down, moving relative references", () => {
    const { doc, sheetId, read } = book([[1, "=A1*2"], [2], [3]]);
    fillCells(
      doc,
      sheetId,
      { top: 0, bottom: 0, left: 1, right: 1 },
      { top: 0, bottom: 2, left: 1, right: 1 },
    );
    expect(read("B1:B3")).toEqual([["=A1*2"], ["=A2*2"], ["=A3*2"]]);
  });

  it("sorts rows under the header by a column, empty cells last", () => {
    const { doc, sheetId, read } = book([
      ["Name", "Score"],
      ["b", 2],
      ["a", 3],
      ["c", 1],
    ]);
    const engine = new WorkbookEngine(doc, { observe: false });
    sortRows(doc, engine, sheetId, 1, "descending", 1);
    expect(read("A1:B4")).toEqual([
      ["Name", "Score"],
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ]);
  });
});

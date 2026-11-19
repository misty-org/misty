import * as Y from "yjs";

/*
 * The parts of a Data workbook an embed can point at, read from the workbook room's layout
 * (space-artifacts-contract.md, "Workbook"): each chart, and each sheet's filled range.
 */

export interface WorkbookPart {
  kind: "data-chart" | "data-range";
  /** A chart's id, or `<sheetId>!{r:<row>,c:<col>}:{r:<row>,c:<col>}` for a range. */
  partId: string;
  title: string;
}

/** A column's letters for a 0-based index: 0 → A, 26 → AA. */
export function columnLetters(index: number): string {
  let letters = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/** The id-anchored range part for a span of a sheet. */
export function rangePartId(
  sheetId: string,
  from: { row: string; col: string },
  to: { row: string; col: string },
): string {
  return `${sheetId}!{r:${from.row},c:${from.col}}:{r:${to.row},c:${to.col}}`;
}

/** The sheet id a range part names. */
export function rangePartSheet(partId: string): string {
  return partId.split("!")[0] ?? "";
}

function arrayOf(value: unknown): string[] {
  return value instanceof Y.Array ? (value.toArray() as unknown[]).map(String) : [];
}

/** Every chart, then every sheet's filled range, in the workbook's order. */
export function listWorkbookParts(doc: Y.Doc): WorkbookPart[] {
  const parts: WorkbookPart[] = [];
  const sheets = doc.getMap<Y.Map<unknown>>("wb:sheets");
  const sheetNames = new Map<string, string>();
  for (const [id, sheet] of sheets) {
    const name = sheet instanceof Y.Map ? sheet.get("name") : undefined;
    sheetNames.set(id, typeof name === "string" && name.trim() ? name.trim() : "Sheet");
  }
  for (const [id, chart] of doc.getMap<Record<string, unknown>>("wb:charts")) {
    const title =
      chart && typeof chart === "object" && typeof chart.title === "string" && chart.title.trim()
        ? chart.title.trim()
        : "Untitled chart";
    parts.push({ kind: "data-chart", partId: id, title });
  }
  const order = arrayOf(doc.getArray("wb:sheetOrder"));
  const sheetIds = order.length ? order : [...sheets.keys()];
  for (const sheetId of sheetIds) {
    const sheet = sheets.get(sheetId);
    if (!(sheet instanceof Y.Map)) continue;
    const rows = arrayOf(sheet.get("rows"));
    const cols = arrayOf(sheet.get("cols"));
    const cells = sheet.get("cells");
    if (!(cells instanceof Y.Map) || !rows.length || !cols.length) continue;
    const rowIndex = new Map(rows.map((id, index) => [id, index]));
    const colIndex = new Map(cols.map((id, index) => [id, index]));
    let top = Infinity;
    let bottom = -1;
    let left = Infinity;
    let right = -1;
    for (const [key, cell] of cells as Y.Map<{ v?: unknown }>) {
      if (!cell || typeof cell !== "object" || cell.v === undefined || cell.v === "") continue;
      const [rowId, colId] = key.split(":");
      const row = rowIndex.get(rowId ?? "");
      const col = colIndex.get(colId ?? "");
      if (row === undefined || col === undefined) continue;
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
      left = Math.min(left, col);
      right = Math.max(right, col);
    }
    if (bottom < 0) continue;
    const a1 = `${columnLetters(left)}${top + 1}:${columnLetters(right)}${bottom + 1}`;
    parts.push({
      kind: "data-range",
      partId: rangePartId(
        sheetId,
        { row: rows[top]!, col: cols[left]! },
        { row: rows[bottom]!, col: cols[right]! },
      ),
      title: `${sheetNames.get(sheetId) ?? "Sheet"} ${a1}`,
    });
  }
  return parts;
}

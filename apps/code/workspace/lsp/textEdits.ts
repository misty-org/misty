import type { TextEdit } from "./lspOperations";

/** LSP positions use UTF-16 in this client. Clamp oversized character positions
 * to their own line, never into the following line. Edits share one original document. */
export function applyTextEdits(contents: string, edits: readonly TextEdit[]) {
  if (!Array.isArray(edits) || edits.length > 8192) throw new Error("Too many text edits.");
  const offsets = [0];
  for (let i = 0; i < contents.length; i++) if (contents[i] === "\n") offsets.push(i + 1);
  const offset = (position: { line: number; character: number }) => {
    if (
      !position ||
      !Number.isSafeInteger(position.line) ||
      position.line < 0 ||
      !Number.isSafeInteger(position.character) ||
      position.character < 0
    )
      throw new Error("Invalid text edit position.");
    if (position.line >= offsets.length) return contents.length;
    let end = position.line + 1 < offsets.length ? offsets[position.line + 1] - 1 : contents.length;
    if (contents[end - 1] === "\r") end--;
    return Math.min(end, offsets[position.line] + position.character);
  };
  const changes = edits
    .map((edit, order) => {
      if (!edit || typeof edit.newText !== "string" || !edit.range)
        throw new Error("Invalid text edit.");
      const from = offset(edit.range.start),
        to = offset(edit.range.end);
      if (
        from > to ||
        edit.range.start.line > edit.range.end.line ||
        (edit.range.start.line === edit.range.end.line &&
          edit.range.start.character > edit.range.end.character)
      )
        throw new Error("Text edit range is reversed.");
      return { from, to, insert: edit.newText.replace(/\r\n/g, "\n"), order };
    })
    .sort((a, b) => a.from - b.from || a.order - b.order);
  let cursor = 0;
  const result: string[] = [];
  for (const change of changes) {
    if (change.from < cursor) throw new Error("Text edits overlap.");
    result.push(contents.slice(cursor, change.from), change.insert);
    cursor = change.to;
  }
  result.push(contents.slice(cursor));
  return result.join("");
}

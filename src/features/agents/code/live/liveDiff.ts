import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import type { CodeDiffLine } from "@/shared/ui";

const context = 3;

/** The lines of `doc` from `from` to `to`, numbered from 1, end exclusive. */
function linesOf(doc: Text, from: number, to: number): Array<{ number: number; text: string }> {
  const out: Array<{ number: number; text: string }> = [];
  for (let number = from; number < to; number++) out.push({ number, text: doc.line(number).text });
  return out;
}

/** The line range a chunk covers on one side: first line, and one past the last. */
function span(doc: Text, from: number, to: number): [number, number] {
  if (to <= from) {
    const line = Math.min(doc.lineAt(Math.min(from, doc.length)).number, doc.lines);
    // An empty side sits before the line its offset starts.
    return from > doc.length ? [doc.lines + 1, doc.lines + 1] : [line, line];
  }
  const first = doc.lineAt(Math.min(from, doc.length)).number;
  const last = doc.lineAt(Math.max(from, Math.min(to - 1, doc.length))).number;
  return [first, last + 1];
}

/** A unified diff of two texts as CodeDiff lines: each change with a few lines around it. */
export function diffLines(before: string, after: string): CodeDiffLine[] {
  const a = Text.of(before.split("\n"));
  const b = Text.of(after.split("\n"));
  const lines: CodeDiffLine[] = [];
  let shownB = 1;
  const chunks = Chunk.build(a, b);
  chunks.forEach((chunk, index) => {
    const next = chunks[index + 1];
    const [fromA, toA] = span(a, chunk.fromA, chunk.toA);
    const [fromB, toB] = span(b, chunk.fromB, chunk.toB);
    const start = Math.max(shownB, fromB - context);
    const lead = fromB - start;
    lines.push({
      kind: "header",
      text: `@@ -${fromA - lead},${toA - fromA + lead} +${start},${toB - fromB + lead} @@`,
    });
    for (const line of linesOf(b, start, fromB))
      lines.push({
        kind: "context",
        text: line.text,
        oldNumber: line.number - fromB + fromA,
        newNumber: line.number,
      });
    for (const line of linesOf(a, fromA, toA))
      lines.push({ kind: "del", text: line.text, oldNumber: line.number });
    for (const line of linesOf(b, fromB, toB))
      lines.push({ kind: "add", text: line.text, newNumber: line.number });
    // Up to the next change, which shows these lines itself.
    const stop = next ? span(b, next.fromB, next.toB)[0] : b.lines + 1;
    const end = Math.min(stop, toB + context);
    for (const line of linesOf(b, toB, end))
      lines.push({
        kind: "context",
        text: line.text,
        oldNumber: line.number - toB + toA,
        newNumber: line.number,
      });
    shownB = end;
  });
  return lines;
}

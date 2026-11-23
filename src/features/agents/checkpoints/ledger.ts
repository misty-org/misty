type LedgerState = "pending" | "done" | "failed" | "blocked" | "skipped";

export interface LedgerRow {
  id: string;
  requirement: string;
  state: LedgerState;
  evidence?: { kind: "tab" | "note" | "file" | "receipt"; ref: string; summary?: string };
  reason?: string;
  needs?: "none" | "input" | "takeover";
  hint?: string;
}

const marker = "<!--misty-ledger:";
const states = new Set<string>(["pending", "done", "failed", "blocked", "skipped"]);

export function splitLedger(text: string): { text: string; rows: LedgerRow[] } {
  const start = text.lastIndexOf(marker);
  if (start < 0) return { text, rows: [] };
  const end = text.indexOf("-->", start);
  if (end < 0) return { text, rows: [] };
  const rest = text.slice(0, start) + text.slice(end + 3);
  try {
    const parsed: unknown = JSON.parse(text.slice(start + marker.length, end));
    if (!Array.isArray(parsed)) return { text: rest.trim(), rows: [] };
    const rows = parsed.filter(
      (row): row is LedgerRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row as LedgerRow).id === "string" &&
        typeof (row as LedgerRow).requirement === "string" &&
        states.has((row as LedgerRow).state),
    );
    return { text: rest.trim(), rows };
  } catch {
    return { text: rest.trim(), rows: [] };
  }
}

export function withLedgerRows(text: string, rows: LedgerRow[]): string {
  const { text: body } = splitLedger(text);
  return body + encodeLedger(rows);
}

function encodeLedger(rows: LedgerRow[]): string {
  return rows.length ? `\n\n${marker}${JSON.stringify(rows).replace(/</g, "\\u003c")}-->` : "";
}

export const isOpen = (row: LedgerRow) => row.state !== "done" && row.state !== "skipped";

export function resumePrompt(rows: LedgerRow[], only?: string[]): string {
  const work = rows.filter((row) => isOpen(row) && (!only || only.includes(row.id)));
  const waiting = rows.filter((row) => isOpen(row) && !work.includes(row));
  const done = rows.filter((row) => row.state === "done");
  const lines = [
    "Continue the request above. Resume the open items; the finished ones stay finished.",
  ];
  if (done.length)
    lines.push(
      "",
      "Done, so don't redo them. If one's evidence is a page, open it once to confirm it still shows the result:",
      ...done.map(
        (row) =>
          `- ${row.requirement}${row.evidence ? ` (${row.evidence.kind}: ${row.evidence.ref})` : ""}`,
      ),
    );
  lines.push(
    "",
    "Open, to work now:",
    ...work.map(
      (row) =>
        `- ${row.requirement}${row.reason ? ` (last time: ${row.reason})` : ""}${row.hint ? `. The person says: ${row.hint}` : ""}`,
    ),
  );
  if (waiting.length)
    lines.push("", "Open, leave alone for now:", ...waiting.map((row) => `- ${row.requirement}`));
  return lines.join("\n") + encodeLedger(rows.map((row) => ({ ...row, state: row.state })));
}

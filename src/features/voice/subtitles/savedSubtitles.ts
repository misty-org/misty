import type { SubtitleHistoryRow } from "./subtitlesView";

/**
 * Sessions the person chose to keep, in this computer's browser storage, as Audeeo keeps a session
 * on its own key. The newest 100 for 30 days, and never more than 2 MB of text.
 */
const key = "misty.live-subtitles.history.v1";
const retentionMs = 30 * 24 * 60 * 60 * 1000;
const maxRows = 100;
const maxBytes = 2_000_000;

export interface SavedSubtitleSession extends SubtitleHistoryRow {
  lines: { source: string; translation: string }[];
}

function read(): SavedSubtitleSession[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(rows)) return [];
    const oldest = Date.now() - retentionMs;
    return (rows as SavedSubtitleSession[]).filter(
      (row) =>
        typeof row?.id === "string" &&
        Array.isArray(row.lines) &&
        Date.parse(row.startedAt) > oldest,
    );
  } catch {
    return [];
  }
}

function write(rows: SavedSubtitleSession[]) {
  const kept = rows.slice(0, maxRows);
  let value = JSON.stringify(kept);
  while (value.length > maxBytes && kept.length > 1) {
    kept.pop();
    value = JSON.stringify(kept);
  }
  localStorage.setItem(key, value);
}

export const subtitleHistory = (): SubtitleHistoryRow[] =>
  read().map(({ id, startedAt, preview }) => ({ id, startedAt, preview }));

export function saveSubtitleSession(session: SavedSubtitleSession) {
  if (session.lines.length) write([session, ...read()]);
}

export function deleteSubtitleSession(id: string) {
  write(read().filter((row) => row.id !== id));
}

/** A kept session as plain text, line by line. */
export function subtitleSessionText(id: string) {
  const row = read().find((item) => item.id === id);
  if (!row) return undefined;
  return row.lines
    .flatMap((line) => [line.source, line.translation, ""])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

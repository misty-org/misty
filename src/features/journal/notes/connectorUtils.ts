import type { UnifiedNote } from "./model/types/types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function previewFrom(body: string): string {
  const flattened = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flattened.length > 160 ? `${flattened.slice(0, 157)}…` : flattened;
}

/**
 * Shared matcher so connector-side search and the client-side filter agree on
 * what "matches" means: title, preview, tags, source, and Space.
 */
export function matchesQuery(note: UnifiedNote, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [note.title, note.preview, note.source, note.spaceName ?? "", ...note.tags]
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}

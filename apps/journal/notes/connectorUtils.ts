import type { UnifiedNote } from "./model/types/types";

let idCounter = 0;

export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Simulated connector latency. Real connectors drop this for actual I/O. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

import type { NoteGroupId, UnifiedNote } from "./model/types";

export function notesInGroup(
  notes: UnifiedNote[],
  group: NoteGroupId,
  _now = Date.now(),
  spaceId?: string,
) {
  switch (group) {
    case "space":
      return notes.filter((note) => Boolean(spaceId) && note.spaceId === spaceId);
    default:
      return notes.filter((note) => Boolean(spaceId) && note.spaceId === spaceId);
  }
}

function sortNotes(notes: UnifiedNote[]): UnifiedNote[] {
  return [...notes].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

/** A note matches when every search term appears in its title, preview, tags, source or Space. */
function matchesQuery(note: UnifiedNote, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [note.title, note.preview, note.source, note.spaceName ?? "", ...note.tags]
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}

export function searchNotes(notes: UnifiedNote[], query: string): UnifiedNote[] {
  return notes.filter((note) => matchesQuery(note, query));
}

export function selectVisibleNotes(
  notes: UnifiedNote[],
  query: string,
  now = Date.now(),
  spaceId?: string,
): UnifiedNote[] {
  return sortNotes(searchNotes(notesInGroup(notes, "space", now, spaceId), query));
}

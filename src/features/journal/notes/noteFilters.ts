import { matchesQuery } from "./connectorUtils";
import type { NoteGroupId, UnifiedNote } from "./model/types/types";

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

export function sortNotes(notes: UnifiedNote[]): UnifiedNote[] {
  return [...notes].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
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

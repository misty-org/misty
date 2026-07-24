import type { NoteGroup, NoteGroupId, UnifiedNote } from "@/models/types/features/notes/types";
import { matchesQuery } from "@/features/notes/connectorUtils";

export const noteGroups: NoteGroup[] = [{ id: "space", label: "Notes" }];

export const defaultNoteGroup: NoteGroupId = "space";

export function noteGroupById(id: NoteGroupId): NoteGroup {
  return noteGroups.find((group) => group.id === id) ?? noteGroups[0];
}

export function isNoteGroupId(value: string): value is NoteGroupId {
  return noteGroups.some((group) => group.id === value);
}

export function notesInGroup(
  notes: UnifiedNote[],
  group: NoteGroupId,
  now = Date.now(),
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

export function groupCounts(
  notes: UnifiedNote[],
  now = Date.now(),
  spaceId?: string,
): Record<NoteGroupId, number> {
  return {
    space: notesInGroup(notes, "space", now, spaceId).length,
  };
}

export function selectVisibleNotes(
  notes: UnifiedNote[],
  query: string,
  now = Date.now(),
  spaceId?: string,
): UnifiedNote[] {
  return sortNotes(searchNotes(notesInGroup(notes, "space", now, spaceId), query));
}

export function relativeTime(iso: string, now = Date.now()): string {
  const elapsed = now - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return "unknown";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

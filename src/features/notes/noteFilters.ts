import type { NoteGroup, NoteGroupId, UnifiedNote } from "@/models/types/features/notes/types";
import { matchesQuery } from "@/features/notes/connectorUtils";

export const noteGroups: NoteGroup[] = [
  { id: "space", label: "In this Space" },
  { id: "all", label: "All Notes" },
  { id: "misty", label: "Misty Notes", source: "misty" },
  { id: "notion", label: "Notion", source: "notion" },
  { id: "unlinked", label: "Unlinked" },
  { id: "recent", label: "Recently Updated" },
  { id: "favorites", label: "Favorites" },
];

export const defaultNoteGroup: NoteGroupId = "space";

const recentWindowMs = 48 * 60 * 60 * 1000;

export function noteGroupById(id: NoteGroupId): NoteGroup {
  return noteGroups.find((group) => group.id === id) ?? noteGroups[0];
}

export function isNoteGroupId(value: string): value is NoteGroupId {
  return noteGroups.some((group) => group.id === value);
}

/** "Unlinked" means the note has no Space assignment — the cleanup queue. */
export function notesInGroup(
  notes: UnifiedNote[],
  group: NoteGroupId,
  now = Date.now(),
  spaceId?: string,
) {
  switch (group) {
    case "space":
      return notes.filter((note) => Boolean(spaceId) && note.spaceId === spaceId);
    case "misty":
      return notes.filter((note) => note.source === "misty");
    case "notion":
      return notes.filter((note) => note.source === "notion");
    case "unlinked":
      return notes.filter((note) => !note.spaceId);
    case "favorites":
      return notes.filter((note) => note.favorite);
    case "recent":
      return notes.filter((note) => now - Date.parse(note.updatedAt) <= recentWindowMs);
    default:
      return notes;
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
    all: notes.length,
    misty: notesInGroup(notes, "misty", now).length,
    notion: notesInGroup(notes, "notion", now).length,
    unlinked: notesInGroup(notes, "unlinked", now).length,
    recent: notesInGroup(notes, "recent", now).length,
    favorites: notesInGroup(notes, "favorites", now).length,
  };
}

export function selectVisibleNotes(
  notes: UnifiedNote[],
  group: NoteGroupId,
  query: string,
  now = Date.now(),
  spaceId?: string,
): UnifiedNote[] {
  return sortNotes(searchNotes(notesInGroup(notes, group, now, spaceId), query));
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

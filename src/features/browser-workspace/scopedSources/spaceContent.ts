import { notesApi, type ServerSpaceNote } from "@/api/notes/api";
import {
  buildLocalIndex,
  searchDocuments,
  searchServerTasks,
} from "@/features/global-search/globalSearchDocuments";
import type { useSpacesStore } from "@/features/spaces/core";
import { resultLimit, searchSpaces, type ScopedSearchResult } from "../scopedSearchSources";

type Space = ReturnType<typeof useSpacesStore.getState>["spaces"][number];

/** Notes are listed per space, so a burst of keystrokes reuses one fetch. */
const noteListTtlMs = 60_000;
const maxNoteSpaces = 10;
const noteLists = new Map<string, { at: number; notes: Promise<ServerSpaceNote[]> }>();

function spaceNotes(spaceId: string): Promise<ServerSpaceNote[]> {
  const cached = noteLists.get(spaceId);
  if (cached && Date.now() - cached.at < noteListTtlMs) return cached.notes;
  const notes = notesApi.list(spaceId).then(
    (response) => response.notes.filter((note) => note.lifecycle_state === "active"),
    () => [],
  );
  noteLists.set(spaceId, { at: Date.now(), notes });
  return notes;
}

function recentSpaces(spaces: readonly Space[]): Space[] {
  return [...spaces]
    .sort((left, right) => (right.updated_at ?? "").localeCompare(left.updated_at ?? ""))
    .slice(0, maxNoteSpaces);
}

export async function searchSpaceNotes(
  query: string,
  spaces: readonly Space[],
): Promise<ScopedSearchResult[]> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const lists = await Promise.all(
    recentSpaces(spaces).map(async (space) => ({ space, notes: await spaceNotes(space.id) })),
  );
  return lists
    .flatMap(({ space, notes }) =>
      notes
        .filter((note) => {
          const text = `${note.title} ${note.plain_text ?? ""}`.toLocaleLowerCase();
          return terms.every((term) => text.includes(term));
        })
        .map((note) => ({ space, note })),
    )
    .sort((left, right) => (right.note.updated_at ?? "").localeCompare(left.note.updated_at ?? ""))
    .slice(0, resultLimit)
    .map<ScopedSearchResult>(({ space, note }) => ({
      id: `note:${note.id}`,
      kind: "note",
      title: note.title || "Untitled note",
      subtitle: space.name,
      target: {
        kind: "route",
        route: `/spaces/${encodeURIComponent(space.id)}/notes?note=${encodeURIComponent(note.id)}&view=doc`,
      },
    }));
}

export async function searchSpaceTasks(
  query: string,
  spaces: readonly Space[],
): Promise<ScopedSearchResult[]> {
  if (!query.trim()) return [];
  const tasks = await searchServerTasks("", query, [...spaces]).catch(() => []);
  return tasks.slice(0, resultLimit).map((task) => ({
    id: task.id,
    kind: "task",
    title: task.title,
    subtitle: task.spaceName ?? "Task",
    target: { kind: "route", route: task.href },
  }));
}

/** Chat messages already on this device; spaces without read access are left out. */
export function searchSpaceChat(query: string): ScopedSearchResult[] {
  if (!query.trim()) return [];
  const messages = buildLocalIndex("").filter((document) => document.kind === "message");
  return searchDocuments(messages, query, resultLimit).map((message) => ({
    id: message.id,
    kind: "message",
    title: message.body,
    subtitle: [message.title, message.spaceName].filter(Boolean).join(" · "),
    target: { kind: "route", route: message.href },
  }));
}

/** Takes from each list in turn, so no single kind crowds out the rest. */
function interleave(lists: ScopedSearchResult[][]): ScopedSearchResult[] {
  const merged: ScopedSearchResult[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest && merged.length < resultLimit; index++)
    for (const list of lists) if (list[index]) merged.push(list[index]);
  return merged.slice(0, resultLimit);
}

/** `!spaces`: spaces and their libraries, notes, tasks and chat, ranked together. */
export async function searchEverythingInSpaces(
  query: string,
  spaces: readonly Space[],
): Promise<ScopedSearchResult[]> {
  const settled = await Promise.allSettled([
    searchSpaces(query, [...spaces]),
    searchSpaceNotes(query, spaces),
    searchSpaceTasks(query, spaces),
    Promise.resolve(searchSpaceChat(query)),
  ]);
  return interleave(settled.map((result) => (result.status === "fulfilled" ? result.value : [])));
}

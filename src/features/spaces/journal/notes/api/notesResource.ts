import {
  peekSpaceResource,
  refreshSpaceResource,
  setSpaceResource,
  useSpaceResource,
} from "../../../api/spaceResource";
import { notesApi, type ServerSpaceNote } from "./api";

const path = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/notes`;

type ListNotes = (spaceId: string) => Promise<{ notes: ServerSpaceNote[] }>;

const loader = (spaceId: string, list: ListNotes) => () =>
  list(spaceId).then((result) => result.notes);

/**
 * A Space's docs, the one copy the Journal, the home page and the overview read: the last list
 * paints at once on a revisit or relaunch and a fresh one follows. `spaceId` empty holds off.
 */
export function useSpaceNoteList(spaceId: string) {
  return useSpaceResource<ServerSpaceNote[]>(
    spaceId ? path(spaceId) : null,
    loader(spaceId, notesApi.list),
  );
}

/** Reads a Space's docs again for every screen that shows them. */
export function reloadSpaceNotes(spaceId: string, list: ListNotes = notesApi.list) {
  return refreshSpaceResource(path(spaceId), loader(spaceId, list));
}

/** The copy of a Space's docs this session holds, if any. */
export function peekSpaceNotes(spaceId: string) {
  return peekSpaceResource<ServerSpaceNote[]>(path(spaceId));
}

/**
 * Changes a Space's docs everywhere they show, such as after one is made here. With no copy yet
 * there is nothing to change: the first read brings the whole list.
 */
export function updateSpaceNotes(
  spaceId: string,
  update: (current: ServerSpaceNote[]) => ServerSpaceNote[],
) {
  const current = peekSpaceNotes(spaceId);
  if (current) setSpaceResource<ServerSpaceNote[]>(path(spaceId), update(current));
}

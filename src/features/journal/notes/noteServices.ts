import type { MistyAppSDK } from "@misty/sdk";
import type { notesApi } from "@/api/notes/api";
import { NotesConnectorRegistry } from "./connectors/NotesConnectorRegistry";
import { createMistyNotesConnector } from "./connectors/mistyNotesConnector";
import { createNotesStore } from "./store/createNotesStore";

export type NativeNotesApi = Pick<
  typeof notesApi,
  "list" | "get" | "create" | "updateMetadata" | "remove" | "archive" | "backlinks"
>;

/** Each downloaded Journal root owns its list, selection and in-flight generation. */
export function createSdkNotesStore(
  misty: MistyAppSDK,
  spaceId: string,
  closeCollaboration: () => void,
) {
  const api = createSdkNotesApi(misty, spaceId);
  return createNotesStore({
    createRegistry: (accountId, requestedSpace, spaceName) =>
      new NotesConnectorRegistry([
        createMistyNotesConnector(api, accountId, requestedSpace, spaceName),
      ]),
    archive: (space, noteId) => api.archive(space, noteId),
    closeCollaboration,
  });
}

/** The view retains its existing API shape while all requests use typed SDK methods. */
export function createSdkNotesApi(misty: MistyAppSDK, spaceId: string): NativeNotesApi {
  const assertSpace = (requested: string) => {
    if (!spaceId || requested !== spaceId)
      throw new Error("This Journal view belongs to a different Space.");
  };
  return {
    async list(space) {
      assertSpace(space);
      return { notes: [...(await misty.notes.list())] };
    },
    get(space, noteID) {
      assertSpace(space);
      return misty.notes.get(noteID);
    },
    create(space, title) {
      assertSpace(space);
      return misty.notes.create({ title });
    },
    updateMetadata(space, noteID, shared_tags) {
      assertSpace(space);
      return misty.notes.update(noteID, { shared_tags });
    },
    remove(space, noteID) {
      assertSpace(space);
      return misty.server.call("notes.delete", { path: { noteID } });
    },
    archive(space, noteID, archived = true) {
      assertSpace(space);
      return misty.server.call("notes.archive", { path: { noteID }, body: { archived } });
    },
    async backlinks(space, noteID) {
      assertSpace(space);
      const result = await misty.server.call("notes.backlinks", { path: { noteID } });
      return { backlinks: result.backlinks ?? [] };
    },
  };
}

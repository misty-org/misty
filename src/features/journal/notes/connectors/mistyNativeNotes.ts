import { notesApi } from "@/api/notes/api";
import { createMistyNotesConnector, listMistySpaceNotesWithApi } from "./mistyNotesConnector";
export function createMistyNativeNotesConnector(accountId = "", spaceId = "", spaceName = "") {
  return createMistyNotesConnector(notesApi, accountId, spaceId, spaceName);
}
export function listMistySpaceNotes(spaceId: string, spaceName: string) {
  return listMistySpaceNotesWithApi(notesApi, spaceId, spaceName);
}

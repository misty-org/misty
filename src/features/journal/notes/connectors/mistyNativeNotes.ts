import { notesApi } from "@/api/notes/api";
import { createMistyNotesConnector } from "./mistyNotesConnector";
export function createMistyNativeNotesConnector(accountId = "", spaceId = "", spaceName = "") {
  return createMistyNotesConnector(notesApi, accountId, spaceId, spaceName);
}

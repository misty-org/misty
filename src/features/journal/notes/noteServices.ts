import type { notesApi } from "@/api/notes/api";

export type NativeNotesApi = Pick<
  typeof notesApi,
  "list" | "get" | "create" | "updateMetadata" | "remove" | "archive" | "backlinks"
>;

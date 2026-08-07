import type { FileEntry } from "@/models/interfaces/services/misty-api";

export type EntryFilterMatcher =
  { kind: "substring"; query: string } | { kind: "pattern"; expression: RegExp };

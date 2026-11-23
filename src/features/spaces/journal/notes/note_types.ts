import type { ItemVisibility } from "../../api/visibility";

export type NoteSource = "misty";

export type NoteBodyFormat = "markdown" | "tiptap-json" | "html";

type NoteSyncStatus = "synced" | "syncing" | "error" | "conflict" | "local-only";

export type UnifiedNote = {
  id: string;
  source: NoteSource;
  sourceId: string;
  title: string;
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
  preview: string;
  spaceId?: string;
  spaceName?: string;
  creatorUserId?: string;
  role?: "creator" | "editor" | "viewer";
  tags: string[];
  backlinks: string[];
  updatedAt: string;
  createdAt: string;
  collaborationRevision?: number;
  backlinkCount?: number;
  syncStatus: NoteSyncStatus;
  canDelete?: boolean;
  visibility?: ItemVisibility;
};

export type NoteGroupId = "space";

export type NotesLoadPhase = "idle" | "loading" | "ready" | "error";

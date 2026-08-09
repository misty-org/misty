export type NoteSource = "misty" | "notion";

export type NoteBodyFormat = "markdown" | "blocknote-json" | "html" | "notion-blocks";

export type NoteSyncStatus = "synced" | "syncing" | "error" | "conflict" | "local-only";

/**
 * Mirrors the connection lifecycle already used by Misty provider remotes so a
 * notes source reports status in the same vocabulary as any other integration.
 */
export type NoteProviderStatus =
  "connected" | "disconnected" | "needs_reconnect" | "syncing" | "error";

export type UnifiedNote = {
  id: string;
  source: NoteSource;
  sourceId: string;
  title: string;
  body: string;
  bodyFormat: NoteBodyFormat;
  /** Plain markdown projection for search, previews, publishing, and legacy readers. */
  bodyMarkdown?: string;
  preview: string;
  spaceId?: string;
  spaceName?: string;
  tags: string[];
  backlinks: string[];
  updatedAt: string;
  createdAt: string;
  favorite: boolean;
  syncStatus: NoteSyncStatus;
  sourceUrl?: string;
  connectorId?: string;
  providerStatus?: NoteProviderStatus;
  /** Server-authoritative delete access for the current user. */
  canDelete?: boolean;
};

/**
 * Left-rail groupings. These are views over the merged note set, not folders.
 * "space" is the default lens inside a Space; the rest stay cross-Space so loose
 * notes can be found and filed without leaving the section.
 */
export type NoteGroupId = "space";

export type NoteGroup = {
  id: NoteGroupId;
  label: string;
  /** Restricts the group to one connector source; omitted for cross-source views. */
  source?: NoteSource;
};

export type NotesLoadPhase = "idle" | "loading" | "ready" | "error";

import type {
  NoteBodyFormat,
  NoteProviderStatus,
  NoteSource,
  UnifiedNote,
} from "@/models/types/features/notes/types";
import type {
  NoteConnectorCapabilities,
  NoteSourceKind,
} from "@/models/types/features/notes/capabilities";

export interface CreateNoteInput {
  title: string;
  body: string;
  bodyFormat?: NoteBodyFormat;
  bodyMarkdown?: string;
  spaceId?: string;
  spaceName?: string;
  tags?: string[];
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  bodyFormat?: NoteBodyFormat;
  bodyMarkdown?: string;
  spaceId?: string;
  spaceName?: string;
  tags?: string[];
  favorite?: boolean;
}

/** A page or database in the source that a Space can subscribe to. */
export interface NoteSourceOption {
  id: string;
  kind: NoteSourceKind;
  title: string;
  url?: string;
  parentTitle?: string;
}

/** Content appended to the end of an existing note. */
export interface AppendNoteInput {
  /** Markdown. The connector shapes it into the source's native blocks. */
  body: string;
}

/**
 * A structured Misty artifact published outward. Beta covers the three shapes a
 * Space actually produces; anything freer is just a `body`.
 */
export interface PublishNoteInput {
  title: string;
  body?: string;
  summary?: string;
  tasks?: Array<{ title: string; done: boolean }>;
  /** Target page or database. Defaults to the connector's selected source. */
  targetId?: string;
  targetKind?: NoteSourceKind;
  /** Simple, known properties to set on the created page. */
  properties?: Record<string, string | number | boolean | string[]>;
}

/** Outcome of a publish, including anything the source refused to accept. */
export interface PublishNoteResult {
  note: UnifiedNote;
  /** Properties skipped because the target schema did not support them. */
  skippedProperties: string[];
}

export interface SyncResult {
  connectorId: string;
  syncedAt: string;
  noteCount: number;
  /** Present when the sync completed with a recoverable problem. */
  error?: string;
}

/**
 * The only surface the Notes UI is allowed to call. Every source — the native
 * Misty store, Notion, anything added later — is reached through this shape, so
 * swapping mock implementations for real provider-backed ones is a drop-in.
 */
export interface NotesConnector {
  id: string;
  /** Provider id in Misty's existing integration registry (e.g. "notion"). */
  providerId: string;
  name: string;
  source: NoteSource;

  /**
   * What this connector can do. The UI branches on these rather than probing
   * for optional methods, so gaining write support is a one-line announcement.
   */
  capabilities: NoteConnectorCapabilities;

  status(): NoteProviderStatus;
  lastSyncedAt(): string | undefined;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  configure?(): Promise<void>;

  listNotes(): Promise<UnifiedNote[]>;
  getNote(sourceId: string): Promise<UnifiedNote>;

  searchNotes?(query: string): Promise<UnifiedNote[]>;

  createNote?(input: CreateNoteInput): Promise<UnifiedNote>;
  updateNote?(sourceId: string, patch: UpdateNoteInput): Promise<UnifiedNote>;

  /** Adds content to the end of an existing note without rewriting it. */
  appendToNote?(sourceId: string, input: AppendNoteInput): Promise<UnifiedNote>;

  /** Publishes a Misty note, summary, or task list outward. */
  publishNote?(input: PublishNoteInput): Promise<PublishNoteResult>;

  /** Sets simple, known structured properties on a note. */
  updateProperties?(
    sourceId: string,
    values: Record<string, string | number | boolean | string[]>,
  ): Promise<{ note: UnifiedNote; skippedProperties: string[] }>;

  /** Pages and databases available to subscribe to as note sources. */
  listSources?(): Promise<NoteSourceOption[]>;
  selectedSourceIds?(): string[];
  selectSources?(sourceIds: string[]): Promise<void>;

  openInSource?(sourceId: string): Promise<void>;
  sync?(): Promise<SyncResult>;
}

/**
 * Catalog entry for the integrations surface. Connectors that cannot yet supply
 * notes ("available", "planned") still appear here so the broader Misty
 * integration system stays discoverable from the Notes area.
 */
export interface NotesIntegrationCard {
  providerId: string;
  name: string;
  description: string;
  availability: "connected" | "available" | "planned";
  status?: NoteProviderStatus;
  lastSyncedAt?: string;
  /** Set when the provider is already connected elsewhere in Misty. */
  connectedElsewhere?: boolean;
  noteCount?: number;
  error?: string;
}

import type { NotesConnectorRegistry } from "../../../../connectors/registry";
import type { CreateNoteInput } from "../../../interfaces/connectors";
import type { NoteBodyFormat, NotesLoadPhase, UnifiedNote } from "../../../types/types";

export interface UpdateNoteContentInput {
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
}

export interface NotesStoreState {
  registry: NotesConnectorRegistry;
  phase: NotesLoadPhase;
  notes: UnifiedNote[];
  /** Keyed by connector id; a present entry renders a calm inline notice. */
  connectorErrors: Record<string, string>;
  selectedNoteId?: string;
  editingNoteId?: string;
  /** Account owning the device-local note partition. */
  accountId?: string;
  /** The Space whose Notes section is mounted; new notes default into it. */
  spaceId?: string;
  spaceName?: string;
  query: string;
  syncing: boolean;
  lastSyncedAt?: string;
  /** Lives in the store because the Space sidebar and the pane are sibling trees. */
  integrationsOpen: boolean;
  /** Bumped whenever connector status changes so selectors recompute. */
  connectorRevision: number;
}

export interface NotesStoreActions {
  load: (accountId: string, spaceId: string, spaceName: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Note currently being published outward, so the action can show progress. */
  publishingNoteId: string;
  /** Last publish outcome worth telling the user about. */
  publishError: string;
  publishNote: (noteId: string, connectorId?: string) => Promise<void>;
  syncAll: () => Promise<void>;
  setQuery: (query: string) => void;
  selectNote: (noteId: string | undefined) => void;
  setEditingNoteId: (noteId: string | undefined) => void;
  setIntegrationsOpen: (open: boolean) => void;
  toggleFavorite: (noteId: string) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<UnifiedNote | undefined>;
  deleteNote: (noteId: string) => Promise<void>;
  updateNoteBody: (noteId: string, body: string) => Promise<void>;
  updateNoteContent: (noteId: string, content: UpdateNoteContentInput) => Promise<void>;
  assignSpace: (noteId: string, spaceId?: string, spaceName?: string) => Promise<void>;
  openInSource: (noteId: string) => Promise<void>;
  connectConnector: (connectorId: string) => Promise<void>;
  disconnectConnector: (connectorId: string) => Promise<void>;
}

export type NotesStore = NotesStoreState & NotesStoreActions;

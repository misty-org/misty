import type { NotesConnectorRegistry } from "@/features/notes/connectors/registry";
import type { CreateNoteInput } from "@/models/interfaces/features/notes/connectors";
import type { NotesLoadPhase, UnifiedNote } from "@/models/types/features/notes/types";

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
  contextPanelOpen: boolean;
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
  toggleContextPanel: () => void;
  setIntegrationsOpen: (open: boolean) => void;
  toggleFavorite: (noteId: string) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<UnifiedNote | undefined>;
  updateNoteBody: (noteId: string, body: string) => Promise<void>;
  assignSpace: (noteId: string, spaceId?: string, spaceName?: string) => Promise<void>;
  openInSource: (noteId: string) => Promise<void>;
  connectConnector: (connectorId: string) => Promise<void>;
  disconnectConnector: (connectorId: string) => Promise<void>;
}

export type NotesStore = NotesStoreState & NotesStoreActions;

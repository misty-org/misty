import { notesApi } from "@/api/notes/api";
import { create } from "zustand";
import { type NotesConnectorRegistry, createDefaultNotesRegistry } from "../connectors/registry";
import { nowIso } from "../connectorUtils";
import { NOTION_CONNECTOR_ID } from "../mockData";
import type { CreateNoteInput } from "../model/interfaces/connectors";
import type { NoteBodyFormat, NotesLoadPhase, UnifiedNote } from "../model/types/types";
import { setNotionScope } from "./notionApi";

let registry = createDefaultNotesRegistry();
let notesLoadGeneration = 0;

export const useNotesStore = create<NotesStore>((set, get) => ({
  registry,
  phase: "idle",
  notes: [],
  connectorErrors: {},
  selectedNoteId: undefined,
  editingNoteId: undefined,
  accountId: undefined,
  spaceId: undefined,
  spaceName: undefined,
  query: "",
  syncing: false,
  lastSyncedAt: undefined,
  publishingNoteId: "",
  publishError: "",
  connectorRevision: 0,

  async load(accountId: string, spaceId: string, spaceName: string) {
    const state = get();
    const sameScope = state.accountId === accountId && state.spaceId === spaceId;
    if (sameScope && state.phase === "ready") return;

    const generation = ++notesLoadGeneration;
    setNotionScope(accountId, spaceId);
    registry = createDefaultNotesRegistry(accountId, spaceId, spaceName);
    const activeRegistry = registry;
    set((current) => ({
      registry: activeRegistry,
      phase: "loading",
      accountId,
      spaceId,
      spaceName,
      notes: [],
      selectedNoteId: undefined,
      editingNoteId: undefined,
      connectorErrors: {},
      syncing: false,
      connectorRevision: current.connectorRevision + 1,
    }));
    const { notes, errors } = await activeRegistry.listAllNotes();
    if (generation !== notesLoadGeneration || registry !== activeRegistry) return;
    const scoped = scopeNotes(notes, spaceId, spaceName);
    set({
      phase: "ready",
      notes: scoped,
      connectorErrors: errors,
      lastSyncedAt: nowIso(),
      selectedNoteId: scoped.find((note) => note.spaceId === spaceId)?.id ?? scoped[0]?.id,
    });
  },

  async refresh() {
    const { spaceId, spaceName } = get();
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const { notes, errors } = await activeRegistry.listAllNotes();
    if (generation !== notesLoadGeneration || registry !== activeRegistry) return;
    set((state) => {
      const scoped = spaceId ? scopeNotes(notes, spaceId, spaceName ?? "") : notes;
      return {
        notes: scoped,
        connectorErrors: errors,
        selectedNoteId: scoped.some((note) => note.id === state.selectedNoteId)
          ? state.selectedNoteId
          : scoped[0]?.id,
      };
    });
  },

  async syncAll() {
    if (get().syncing) return;
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    set((state) => ({ syncing: true, connectorRevision: state.connectorRevision + 1 }));
    const results = await activeRegistry.syncAll();
    const errors: Record<string, string> = {};
    for (const result of results) {
      if (result.error) errors[result.connectorId] = result.error;
    }
    const { notes } = await activeRegistry.listAllNotes();
    if (generation !== notesLoadGeneration || registry !== activeRegistry) return;
    set((state) => ({
      syncing: false,
      notes: state.spaceId ? scopeNotes(notes, state.spaceId, state.spaceName ?? "") : notes,
      connectorErrors: errors,
      lastSyncedAt: nowIso(),
      connectorRevision: state.connectorRevision + 1,
    }));
  },

  setQuery(query: string) {
    set({ query });
  },

  selectNote(selectedNoteId) {
    set({ selectedNoteId });
  },

  setEditingNoteId(editingNoteId) {
    set({ editingNoteId });
  },

  async createNote(input: CreateNoteInput) {
    const { spaceId, spaceName } = get();
    if (!spaceId || !spaceName) {
      reportConnectorError(set, "notes:misty", new Error("Open a Space before creating a note."));
      return undefined;
    }
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const connector = activeRegistry.forSource("misty");
    try {
      const created = await connector?.createNote?.({
        ...input,
        spaceId,
        spaceName,
      });
      if (!created || !notesActionIsCurrent(generation, activeRegistry)) return undefined;
      set((state) => ({
        notes: [created, ...state.notes],
        selectedNoteId: created.id,
        editingNoteId: connector?.capabilities.update ? created.id : undefined,
        query: "",
      }));
      return created;
    } catch (reason) {
      reportConnectorError(set, connector?.id ?? "notes:misty", reason);
      return undefined;
    }
  },

  async deleteNote(noteId: string) {
    const note = findNote(get().notes, noteId);
    if (!note) return;
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const connector = activeRegistry.forSource(note.source);
    if (!connector?.capabilities.delete || !connector.deleteNote) {
      throw new Error("This note source does not support deletion.");
    }
    try {
      await connector.deleteNote(note.sourceId);
      if (!notesActionIsCurrent(generation, activeRegistry)) return;
      closeOpenNoteCollaborationSessions();
      set((state) => {
        const deletedIndex = state.notes.findIndex((candidate) => candidate.id === noteId);
        const notes = state.notes.filter((candidate) => candidate.id !== noteId);
        const nextSelectedNoteId =
          state.selectedNoteId === noteId
            ? (notes[deletedIndex] ?? notes[deletedIndex - 1] ?? notes[0])?.id
            : state.selectedNoteId;
        return {
          notes,
          selectedNoteId: nextSelectedNoteId,
          editingNoteId: state.editingNoteId === noteId ? undefined : state.editingNoteId,
        };
      });
    } catch (reason) {
      reportConnectorError(set, connector.id, reason);
      throw reason;
    }
  },

  async archiveNote(noteId: string) {
    const note = findNote(get().notes, noteId);
    if (!note?.spaceId || note.source !== "misty" || !note.canDelete) {
      throw new Error("This note cannot be archived.");
    }
    await notesApi.archive(note.spaceId, note.sourceId);
    set((state) => ({
      notes: state.notes.filter((candidate) => candidate.id !== noteId),
      selectedNoteId:
        state.selectedNoteId === noteId
          ? state.notes.find((candidate) => candidate.id !== noteId)?.id
          : state.selectedNoteId,
    }));
  },

  async updateNoteBody(noteId: string, body: string) {
    await get().updateNoteContent(noteId, { body, bodyFormat: "markdown" });
  },

  async updateNoteContent(noteId: string, content) {
    const note = findNote(get().notes, noteId);
    if (!note) return;
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const connector = activeRegistry.forSource(note.source);
    try {
      const updated = await connector?.updateNote?.(note.sourceId, content);
      if (!updated || !notesActionIsCurrent(generation, activeRegistry)) return;
      replaceNote(set, noteId, updated);
    } catch (reason) {
      reportConnectorError(set, connector?.id ?? note.connectorId ?? "notes", reason);
    }
  },

  async assignSpace(noteId: string, spaceId?: string, spaceName?: string) {
    const note = findNote(get().notes, noteId);
    if (!note) return;
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const connector = activeRegistry.forSource(note.source);
    try {
      const updated = await connector?.updateNote?.(note.sourceId, { spaceId, spaceName });
      if (!updated || !notesActionIsCurrent(generation, activeRegistry)) return;
      replaceNote(set, noteId, updated);
    } catch (reason) {
      reportConnectorError(set, connector?.id ?? note.connectorId ?? "notes", reason);
    }
  },

  /**
   * Publishes a Misty note outward as a new page in the target source. This is
   * an explicit user action, never a side effect of editing — the note stays
   * the Misty original and the Notion page is a published copy.
   */
  async publishNote(noteId: string, connectorId = NOTION_CONNECTOR_ID) {
    const note = findNote(get().notes, noteId);
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const connector = activeRegistry.get(connectorId);
    if (!note || !connector?.publishNote) return;
    set({ publishingNoteId: noteId, publishError: "" });
    try {
      const result = await connector.publishNote({
        title: note.title,
        body: note.bodyMarkdown ?? note.body,
      });
      if (!notesActionIsCurrent(generation, activeRegistry)) return;
      const skipped = result.skippedProperties.length
        ? `Published. ${result.skippedProperties.length} field could not be mapped.`
        : "";
      set((state) => ({
        publishingNoteId: "",
        publishError: skipped,
        connectorRevision: state.connectorRevision + 1,
      }));
    } catch (reason) {
      if (!notesActionIsCurrent(generation, activeRegistry)) return;
      set({
        publishingNoteId: "",
        publishError: reason instanceof Error ? reason.message : "Publishing to Notion failed.",
      });
    }
  },

  async openInSource(noteId: string) {
    const note = findNote(get().notes, noteId);
    if (!note) return;
    const connector = registry.forSource(note.source);
    await connector?.openInSource?.(note.sourceId);
  },

  async connectConnector(connectorId: string) {
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const connector = activeRegistry.get(connectorId);
    if (!connector) return;
    set((state) => ({ syncing: true, connectorRevision: state.connectorRevision + 1 }));
    try {
      await connector.connect();
      const { notes, errors } = await activeRegistry.listAllNotes();
      if (!notesActionIsCurrent(generation, activeRegistry)) return;
      set((state) => ({
        syncing: false,
        notes: state.spaceId ? scopeNotes(notes, state.spaceId, state.spaceName ?? "") : notes,
        connectorErrors: errors,
        lastSyncedAt: nowIso(),
        connectorRevision: state.connectorRevision + 1,
      }));
    } catch (reason) {
      if (!notesActionIsCurrent(generation, activeRegistry)) return;
      set((state) => ({
        syncing: false,
        connectorErrors: { ...state.connectorErrors, [connector.id]: errorMessage(reason) },
        connectorRevision: state.connectorRevision + 1,
      }));
    }
  },

  async disconnectConnector(connectorId: string) {
    const generation = notesLoadGeneration;
    const activeRegistry = registry;
    const connector = activeRegistry.get(connectorId);
    if (!connector) return;
    try {
      await connector.disconnect();
      const { notes, errors } = await activeRegistry.listAllNotes();
      if (!notesActionIsCurrent(generation, activeRegistry)) return;
      set((state) => {
        const scoped = state.spaceId
          ? scopeNotes(notes, state.spaceId, state.spaceName ?? "")
          : notes;
        return {
          notes: scoped,
          connectorErrors: errors,
          selectedNoteId: scoped.some((candidate) => candidate.id === state.selectedNoteId)
            ? state.selectedNoteId
            : scoped[0]?.id,
          connectorRevision: state.connectorRevision + 1,
        };
      });
    } catch (reason) {
      reportConnectorError(set, connector.id, reason);
    }
  },
}));

export function resetNotesAccountState(): void {
  closeOpenNoteCollaborationSessions();
  notesLoadGeneration += 1;
  setNotionScope("", "");
  registry = createDefaultNotesRegistry();
  useNotesStore.setState({
    registry,
    phase: "idle",
    notes: [],
    connectorErrors: {},
    selectedNoteId: undefined,
    editingNoteId: undefined,
    accountId: undefined,
    spaceId: undefined,
    spaceName: undefined,
    query: "",
    syncing: false,
    lastSyncedAt: undefined,
    publishingNoteId: "",
    publishError: "",
    connectorRevision: 0,
  });
}

function closeOpenNoteCollaborationSessions(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("misty:note-collaboration-close-all"));
}

function findNote(notes: UnifiedNote[], noteId: string): UnifiedNote | undefined {
  return notes.find((note) => note.id === noteId);
}

function replaceNote(
  set: (updater: (state: NotesStore) => Partial<NotesStore>) => void,
  noteId: string,
  replacement: UnifiedNote,
) {
  set((state) => ({
    notes: state.notes.map((note) => (note.id === noteId ? replacement : note)),
  }));
}

function scopeNotes(notes: UnifiedNote[], spaceId: string, spaceName: string): UnifiedNote[] {
  void spaceName;
  return notes.filter((note) => note.spaceId === spaceId);
}

function notesActionIsCurrent(generation: number, activeRegistry: typeof registry): boolean {
  return generation === notesLoadGeneration && registry === activeRegistry;
}

function reportConnectorError(
  set: (updater: (state: NotesStore) => Partial<NotesStore>) => void,
  connectorId: string,
  reason: unknown,
): void {
  set((state) => ({
    connectorErrors: { ...state.connectorErrors, [connectorId]: errorMessage(reason) },
  }));
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Misty could not update this note.";
}

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
  createNote: (input: CreateNoteInput) => Promise<UnifiedNote | undefined>;
  deleteNote: (noteId: string) => Promise<void>;
  archiveNote: (noteId: string) => Promise<void>;
  updateNoteBody: (noteId: string, body: string) => Promise<void>;
  updateNoteContent: (noteId: string, content: UpdateNoteContentInput) => Promise<void>;
  assignSpace: (noteId: string, spaceId?: string, spaceName?: string) => Promise<void>;
  openInSource: (noteId: string) => Promise<void>;
  connectConnector: (connectorId: string) => Promise<void>;
  disconnectConnector: (connectorId: string) => Promise<void>;
}

export type NotesStore = NotesStoreState & NotesStoreActions;

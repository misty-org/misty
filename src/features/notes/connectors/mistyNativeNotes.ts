import type {
  CreateNoteInput,
  NotesConnector,
  SyncResult,
  UpdateNoteInput,
} from "@/models/interfaces/features/notes/connectors";
import type { UnifiedNote } from "@/models/types/features/notes/types";
import { MISTY_CONNECTOR_ID, mistyNoteSeed } from "@/features/notes/mockData";
import { delay, matchesQuery, nextId, nowIso, previewFrom } from "@/features/notes/connectorUtils";

/**
 * Account-scoped device storage for native Misty notes. An empty account id is
 * reserved for isolated connector tests and retains the deterministic seed.
 */
export function createMistyNativeNotesConnector(accountId = ""): NotesConnector {
  const storageKey = accountId ? nativeNotesStorageKey(accountId) : "";
  let notes = storageKey ? readNativeNotes(storageKey) : mistyNoteSeed.map((note) => ({ ...note }));
  notes = notes.filter(isSpaceAttachedNote);
  if (storageKey) writeNativeNotes(storageKey, notes);
  let syncedAt = nowIso();

  function commit(next: UnifiedNote[]): void {
    if (storageKey) writeNativeNotes(storageKey, next);
    notes = next;
  }

  function find(sourceId: string): UnifiedNote {
    const note = notes.find((candidate) => candidate.sourceId === sourceId);
    if (!note) throw new Error(`Misty note not found: ${sourceId}`);
    return { ...note };
  }

  return {
    id: MISTY_CONNECTOR_ID,
    providerId: "misty",
    name: "Misty Notes",
    source: "misty",
    capabilities: {
      read: true,
      create: true,
      append: true,
      update: true,
      // Native notes have no external schema to reconcile.
      updateProperties: false,
      openInSource: false,
      sync: true,
      selectSources: false,
    },

    status: () => "connected",
    lastSyncedAt: () => syncedAt,

    async connect() {},
    async disconnect() {},

    async listNotes() {
      await delay(140);
      return notes.map((note) => ({ ...note }));
    },

    async getNote(sourceId: string) {
      await delay(60);
      return find(sourceId);
    },

    async searchNotes(query: string) {
      await delay(80);
      return notes.filter((note) => matchesQuery(note, query)).map((note) => ({ ...note }));
    },

    async createNote(input: CreateNoteInput) {
      await delay(120);
      if (!input.spaceId || !input.spaceName) {
        throw new Error("Misty notes must belong to a Space.");
      }
      const sourceId = nextId("note");
      const timestamp = nowIso();
      const created: UnifiedNote = {
        id: `misty:${sourceId}`,
        source: "misty",
        sourceId,
        title: input.title.trim() || "Untitled note",
        body: input.body,
        bodyFormat: "markdown",
        preview: previewFrom(input.body),
        spaceId: input.spaceId,
        spaceName: input.spaceName,
        tags: input.tags ?? [],
        backlinks: [],
        updatedAt: timestamp,
        createdAt: timestamp,
        favorite: false,
        syncStatus: "local-only",
        connectorId: MISTY_CONNECTOR_ID,
        providerStatus: "connected",
      };
      commit([created, ...notes]);
      return { ...created };
    },

    async updateNote(sourceId: string, patch: UpdateNoteInput) {
      await delay(90);
      const existing = find(sourceId);
      const updated: UnifiedNote = {
        ...existing,
        ...patch,
        preview: patch.body === undefined ? existing.preview : previewFrom(patch.body),
        updatedAt: nowIso(),
      };
      commit(notes.map((note) => (note.sourceId === sourceId ? updated : note)));
      return { ...updated };
    },

    async sync(): Promise<SyncResult> {
      await delay(200);
      syncedAt = nowIso();
      return { connectorId: MISTY_CONNECTOR_ID, syncedAt, noteCount: notes.length };
    },
  };
}

function nativeNotesStorageKey(accountId: string): string {
  return `misty.notes.native.v1.${encodeURIComponent(accountId)}`;
}

function readNativeNotes(storageKey: string): UnifiedNote[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isStoredNativeNote) : [];
  } catch {
    return [];
  }
}

function writeNativeNotes(storageKey: string, notes: UnifiedNote[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(notes));
  } catch {
    throw new Error("Misty could not save this note on this device.");
  }
}

function isStoredNativeNote(value: unknown): value is UnifiedNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<UnifiedNote>;
  return (
    note.source === "misty" &&
    typeof note.id === "string" &&
    typeof note.sourceId === "string" &&
    typeof note.title === "string" &&
    typeof note.body === "string" &&
    typeof note.preview === "string" &&
    typeof note.updatedAt === "string" &&
    typeof note.createdAt === "string" &&
    Array.isArray(note.tags) &&
    Array.isArray(note.backlinks)
  );
}

function isSpaceAttachedNote(note: UnifiedNote): boolean {
  return Boolean(note.spaceId && note.spaceName);
}

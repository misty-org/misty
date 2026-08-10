import { spaceRequest } from "@/services/spaces/api";
import { nowIso, previewFrom } from "../connectorUtils";
import { MISTY_CONNECTOR_ID } from "../mockData";
import type {
  CreateNoteInput,
  NotesConnector,
  SyncResult,
  UpdateNoteInput,
} from "../model/interfaces/connectors";
import type { UnifiedNote } from "../model/types/types";

type ServerSpaceNote = {
  id: string;
  space_id: string;
  creator_user_id: string;
  title: string;
  plain_text?: string;
  lifecycle_state: string;
  collaboration_revision: number;
  acl_version: number;
  role: "creator" | "editor" | "viewer";
  created_at?: string;
  updated_at?: string;
};

/**
 * Native Misty notes are server-backed Space documents. The collaborative Yjs
 * body lives in Cloudflare; this connector handles the server metadata and list
 * projection, never device-local note storage.
 */
export function createMistyNativeNotesConnector(
  _accountId = "",
  spaceId = "",
  spaceName = "",
): NotesConnector {
  let syncedAt = nowIso();
  const noteSpaces = new Map<string, { spaceId: string; spaceName: string }>();

  return {
    id: MISTY_CONNECTOR_ID,
    providerId: "misty",
    name: "Misty Notes",
    source: "misty",
    capabilities: {
      read: true,
      create: true,
      append: false,
      update: false,
      delete: true,
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
      if (!spaceId) return [];
      const notes = await listMistySpaceNotes(spaceId, spaceName);
      rememberNotes(noteSpaces, notes);
      syncedAt = nowIso();
      return notes;
    },

    async getNote(sourceId: string) {
      const scope = noteSpaces.get(sourceId);
      const note = await spaceRequest<ServerSpaceNote>(
        `/spaces/${encodeURIComponent(scope?.spaceId ?? spaceId)}/notes/${encodeURIComponent(sourceId)}`,
      );
      const mapped = mapServerNote(note, scope?.spaceName ?? spaceName);
      rememberNotes(noteSpaces, [mapped]);
      return mapped;
    },

    async searchNotes(query: string) {
      const normalized = query.trim().toLowerCase();
      const notes = await this.listNotes();
      return normalized
        ? notes.filter((note) =>
            [note.title, note.preview, note.bodyMarkdown ?? note.body]
              .join(" ")
              .toLowerCase()
              .includes(normalized),
          )
        : notes;
    },

    async createNote(input: CreateNoteInput) {
      if (!input.spaceId || !input.spaceName) {
        throw new Error("Misty notes must belong to a Space.");
      }
      const created = await spaceRequest<ServerSpaceNote>(
        `/spaces/${encodeURIComponent(input.spaceId)}/notes`,
        {
          method: "POST",
          body: JSON.stringify({ title: input.title.trim() || "Untitled note" }),
        },
      );
      syncedAt = nowIso();
      const mapped = mapServerNote(created, input.spaceName);
      rememberNotes(noteSpaces, [mapped]);
      return mapped;
    },

    async updateNote(sourceId: string, patch: UpdateNoteInput) {
      const scope = noteSpaces.get(sourceId);
      const targetSpaceId = patch.spaceId ?? scope?.spaceId ?? spaceId;
      if (patch.tags) {
        const updated = await spaceRequest<ServerSpaceNote>(
          `/spaces/${encodeURIComponent(targetSpaceId)}/notes/${encodeURIComponent(sourceId)}/metadata`,
          {
            method: "PATCH",
            body: JSON.stringify({ shared_tags: patch.tags }),
          },
        );
        syncedAt = nowIso();
        const mapped = mapServerNote(updated, patch.spaceName ?? scope?.spaceName ?? spaceName);
        rememberNotes(noteSpaces, [mapped]);
        return mapped;
      }
      throw new Error(
        "Misty note content is collaborative and must be edited through the live note room.",
      );
    },

    async deleteNote(sourceId: string) {
      const scope = noteSpaces.get(sourceId);
      const targetSpaceId = scope?.spaceId ?? spaceId;
      if (!targetSpaceId) throw new Error("Open the note's Space before deleting it.");
      await spaceRequest(
        `/spaces/${encodeURIComponent(targetSpaceId)}/notes/${encodeURIComponent(sourceId)}`,
        { method: "DELETE" },
      );
      noteSpaces.delete(sourceId);
      syncedAt = nowIso();
    },

    async sync(): Promise<SyncResult> {
      syncedAt = nowIso();
      const notes = spaceId ? await listMistySpaceNotes(spaceId, spaceName) : [];
      rememberNotes(noteSpaces, notes);
      return { connectorId: MISTY_CONNECTOR_ID, syncedAt, noteCount: notes.length };
    },
  };
}

export async function listMistySpaceNotes(
  spaceId: string,
  spaceName: string,
): Promise<UnifiedNote[]> {
  const result = await spaceRequest<{ notes: ServerSpaceNote[] }>(
    `/spaces/${encodeURIComponent(spaceId)}/notes`,
  );
  return result.notes.map((note) => mapServerNote(note, spaceName));
}

function mapServerNote(note: ServerSpaceNote, spaceName = ""): UnifiedNote {
  const timestamp = note.updated_at ?? note.created_at ?? nowIso();
  const bodyMarkdown = note.plain_text ?? "";
  return {
    id: `misty:${note.id}`,
    source: "misty",
    sourceId: note.id,
    title: note.title.trim() || "Untitled note",
    body: bodyMarkdown,
    bodyFormat: "markdown",
    bodyMarkdown,
    preview: previewFrom(bodyMarkdown),
    spaceId: note.space_id,
    spaceName,
    tags: [],
    backlinks: [],
    updatedAt: timestamp,
    createdAt: note.created_at ?? timestamp,
    favorite: false,
    syncStatus: "synced",
    connectorId: MISTY_CONNECTOR_ID,
    providerStatus: "connected",
    canDelete: note.role === "creator",
  };
}

function rememberNotes(
  noteSpaces: Map<string, { spaceId: string; spaceName: string }>,
  notes: UnifiedNote[],
): void {
  for (const note of notes) {
    if (note.spaceId)
      noteSpaces.set(note.sourceId, { spaceId: note.spaceId, spaceName: note.spaceName ?? "" });
  }
}

import type { ServerSpaceNote } from "@/api/notes/api";
import type { UnifiedNote } from "./model/types";

/**
 * Native Misty notes are server-backed Space documents. The collaborative Yjs
 * body lives in Cloudflare; this is the server metadata's list projection.
 */
export function mapServerNote(note: ServerSpaceNote, spaceName = ""): UnifiedNote {
  const timestamp = note.updated_at ?? note.created_at ?? new Date().toISOString();
  const bodyMarkdown = note.markdown ?? note.plain_text ?? "";
  return {
    id: `misty:${note.id}`,
    source: "misty",
    sourceId: note.id,
    title: note.title.trim() || "Untitled note",
    body: bodyMarkdown,
    bodyFormat: "markdown",
    bodyMarkdown,
    preview: previewFrom(note.plain_text ?? bodyMarkdown),
    spaceId: note.space_id,
    spaceName,
    creatorUserId: note.creator_user_id,
    role: note.role,
    tags: [],
    backlinks: [],
    backlinkCount: note.backlink_count ?? 0,
    updatedAt: timestamp,
    createdAt: note.created_at ?? timestamp,
    collaborationRevision: note.collaboration_revision,
    syncStatus: "synced",
    canDelete: note.can_delete ?? note.role === "creator",
  };
}

function previewFrom(body: string): string {
  const flattened = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flattened.length > 160 ? `${flattened.slice(0, 157)}…` : flattened;
}

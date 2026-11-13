import { spaceRequest } from "../../../api/api";
import type { ItemVisibility } from "../../../api/visibility";

const part = encodeURIComponent;

export interface ServerSpaceNote {
  id: string;
  space_id: string;
  creator_user_id: string;
  title: string;
  markdown?: string;
  plain_text?: string;
  lifecycle_state: string;
  collaboration_revision: number;
  acl_version: number;
  role: "creator" | "editor" | "viewer";
  can_delete?: boolean;
  created_at?: string;
  updated_at?: string;
  backlink_count?: number;
  /** A private note opens only for its creator. */
  visibility?: ItemVisibility;
}

type NoteCollaborationRole = "creator" | "editor" | "viewer";

export interface NoteCollaborationTicket {
  ticket: string;
  room: string;
  url: string;
  role: NoteCollaborationRole;
  expires_at: string;
}

export const notesApi = {
  list: (spaceId: string) =>
    spaceRequest<{ notes: ServerSpaceNote[] }>(`/spaces/${part(spaceId)}/notes`),
  get: (spaceId: string, noteId: string) =>
    spaceRequest<ServerSpaceNote>(`/spaces/${part(spaceId)}/notes/${part(noteId)}`),
  create: (spaceId: string, title: string) =>
    spaceRequest<ServerSpaceNote>(`/spaces/${part(spaceId)}/notes`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  /** A doc made with a body, as a Lab notebook shared into the Space is. */
  createWithMarkdown: (spaceId: string, title: string, markdown: string) =>
    spaceRequest<ServerSpaceNote>(`/spaces/${part(spaceId)}/notes`, {
      method: "POST",
      body: JSON.stringify({ title, markdown }),
    }),
  /** Replaces a doc's title and body, as a shared notebook keeps its doc up to date. */
  replaceContent: (spaceId: string, noteId: string, title: string, markdown: string) =>
    spaceRequest<ServerSpaceNote>(`/spaces/${part(spaceId)}/notes/${part(noteId)}/content`, {
      method: "PUT",
      body: JSON.stringify({ title, markdown }),
    }),
  updateMetadata: (spaceId: string, noteId: string, sharedTags: string[]) =>
    spaceRequest<ServerSpaceNote>(`/spaces/${part(spaceId)}/notes/${part(noteId)}/metadata`, {
      method: "PATCH",
      body: JSON.stringify({ shared_tags: sharedTags }),
    }),
  remove: (spaceId: string, noteId: string) =>
    spaceRequest(`/spaces/${part(spaceId)}/notes/${part(noteId)}`, { method: "DELETE" }),
  archive: (spaceId: string, noteId: string, archived = true) =>
    spaceRequest(`/spaces/${part(spaceId)}/notes/${part(noteId)}`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    }),
  collaborationTicket: (spaceId: string, noteId: string) =>
    spaceRequest<NoteCollaborationTicket>(
      `/spaces/${part(spaceId)}/notes/${part(noteId)}/collaboration-ticket`,
      { method: "POST" },
    ),
  backlinks: (spaceId: string, noteId: string) =>
    spaceRequest<{ backlinks: Array<{ id: string; title: string; updated_at: string }> }>(
      `/spaces/${part(spaceId)}/notes/${part(noteId)}/backlinks`,
    ),
};

import { spaceRequest } from "@/api/spaces/api";

const part = encodeURIComponent;

export interface ServerSpaceNote {
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
}

export type NoteCollaborationRole = "creator" | "editor" | "viewer";

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
  updateMetadata: (spaceId: string, noteId: string, sharedTags: string[]) =>
    spaceRequest<ServerSpaceNote>(`/spaces/${part(spaceId)}/notes/${part(noteId)}/metadata`, {
      method: "PATCH",
      body: JSON.stringify({ shared_tags: sharedTags }),
    }),
  remove: (spaceId: string, noteId: string) =>
    spaceRequest(`/spaces/${part(spaceId)}/notes/${part(noteId)}`, { method: "DELETE" }),
  collaborationTicket: (spaceId: string, noteId: string) =>
    spaceRequest<NoteCollaborationTicket>(
      `/spaces/${part(spaceId)}/notes/${part(noteId)}/collaboration-ticket`,
      { method: "POST" },
    ),
};

function notionBase(spaceId: string): string {
  return `/spaces/${part(spaceId)}/integrations/notion`;
}

export const notionApi = {
  status: (spaceId: string) =>
    spaceRequest<{ connected: boolean }>(`${notionBase(spaceId)}/status`),
  authorize: (spaceId: string, returnTo: string) =>
    spaceRequest<{ authorization_url: string }>(`${notionBase(spaceId)}/authorize`, {
      method: "POST",
      body: JSON.stringify({ return_to: returnTo }),
    }),
  disconnect: (spaceId: string) =>
    spaceRequest(`${notionBase(spaceId)}/connection`, { method: "DELETE" }),
  listSources: <T>(spaceId: string) =>
    spaceRequest<{ sources: T[] }>(`${notionBase(spaceId)}/sources`),
  getPage: <T>(spaceId: string, pageId: string) =>
    spaceRequest<T>(`${notionBase(spaceId)}/pages/${part(pageId)}`),
  getPageBlocks: <T>(spaceId: string, pageId: string) =>
    spaceRequest<{ blocks: T[] }>(`${notionBase(spaceId)}/pages/${part(pageId)}/blocks`),
  queryDatabase: <T>(spaceId: string, databaseId: string) =>
    spaceRequest<{ pages: T[] }>(`${notionBase(spaceId)}/databases/${part(databaseId)}/query`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getDatabase: <T>(spaceId: string, databaseId: string) =>
    spaceRequest<T>(`${notionBase(spaceId)}/databases/${part(databaseId)}`),
  search: <T>(spaceId: string, query: string) =>
    spaceRequest<{ pages: T[] }>(`${notionBase(spaceId)}/search?q=${part(query)}`),
  createPage: <T>(spaceId: string, payload: unknown) =>
    spaceRequest<T>(`${notionBase(spaceId)}/pages`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  appendBlocks: (spaceId: string, blockId: string, children: unknown[]) =>
    spaceRequest(`${notionBase(spaceId)}/blocks/${part(blockId)}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children }),
    }),
  updatePageProperties: <T>(spaceId: string, pageId: string, properties: unknown) =>
    spaceRequest<T>(`${notionBase(spaceId)}/pages/${part(pageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    }),
};

import { spaceRequest } from "../api/api";
import type { ItemVisibility } from "../api/visibility";

/** What this person can do with a deck. */
export type DeckRole = "creator" | "editor" | "viewer";

/** A deck as the server lists it: the same fields as a drawing, plus its search projection. */
export interface SpaceDeck {
  id: string;
  space_id: string;
  creator_user_id: string;
  title: string;
  lifecycle_state: "active" | "deleting";
  collaboration_revision: number;
  acl_version: number;
  created_at: string;
  updated_at: string;
  role: DeckRole;
  can_delete: boolean;
  /** A private deck opens only for its creator. */
  visibility?: ItemVisibility;
  /** The search projection: the title and every slide's text, at most 100k characters. */
  plain_text?: string;
  /** The room's snapshot size, counted toward storage. */
  content_bytes?: number;
}

export interface DeckCollaborationTicket {
  ticket: string;
  room: string;
  url: string;
  role: DeckRole;
  expires_at: string;
}

/** Where a Space's decks live, the key every screen that lists them shares. */
export const spaceDecksPath = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/decks`;

function deckPath(spaceId: string, deckId?: string): string {
  const base = spaceDecksPath(spaceId);
  return deckId ? `${base}/${encodeURIComponent(deckId)}` : base;
}

export const decksApi = {
  list: (spaceId: string) => spaceRequest<{ decks: SpaceDeck[] }>(deckPath(spaceId)),
  create: (spaceId: string, title: string) =>
    spaceRequest<SpaceDeck>(deckPath(spaceId), {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  get: (spaceId: string, deckId: string) => spaceRequest<SpaceDeck>(deckPath(spaceId, deckId)),
  rename: (spaceId: string, deckId: string, title: string) =>
    spaceRequest<SpaceDeck>(deckPath(spaceId, deckId), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  remove: (spaceId: string, deckId: string) =>
    spaceRequest(deckPath(spaceId, deckId), { method: "DELETE" }),
  collaborationTicket: (spaceId: string, deckId: string) =>
    spaceRequest<DeckCollaborationTicket>(`${deckPath(spaceId, deckId)}/collaboration-ticket`, {
      method: "POST",
    }),
};

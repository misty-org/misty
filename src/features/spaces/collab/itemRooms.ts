import { spaceRequest } from "../api/api";
import { drawingsApi } from "../journal/drawings/api/api";
import { notesApi } from "../journal/notes/api/api";

/** The Space items that live in a collaboration room, as the server and the agent tools name them. */
export type RoomItemKind = "note" | "drawing" | "deck" | "workbook";

/** A room's ticket, as every kind's `collaboration-ticket` route answers it. */
export interface RoomTicket {
  ticket: string;
  room: string;
  url: string;
  role: "creator" | "editor" | "viewer";
  expires_at: string;
}

type RoomParty = "note-room" | "drawing-room" | "deck-room" | "workbook-room";

const rooms: Record<RoomItemKind, { collection: string; party: RoomParty }> = {
  note: { collection: "notes", party: "note-room" },
  drawing: { collection: "drawings", party: "drawing-room" },
  deck: { collection: "decks", party: "deck-room" },
  workbook: { collection: "workbooks", party: "workbook-room" },
};

/** The route collection of a kind: `notes`, `drawings`, `decks` or `workbooks`. */
export function roomCollection(kind: RoomItemKind): string {
  return rooms[kind].collection;
}

export function roomParty(kind: RoomItemKind): RoomParty {
  return rooms[kind].party;
}

/** A fresh, single-use ticket into an item's room, from the kind's own API. */
export function requestRoomTicket(
  kind: RoomItemKind,
  spaceId: string,
  itemId: string,
): Promise<RoomTicket> {
  if (kind === "note") return notesApi.collaborationTicket(spaceId, itemId);
  if (kind === "drawing") return drawingsApi.collaborationTicket(spaceId, itemId);
  const part = encodeURIComponent;
  return spaceRequest<RoomTicket>(
    `/spaces/${part(spaceId)}/${roomCollection(kind)}/${part(itemId)}/collaboration-ticket`,
    { method: "POST" },
  );
}

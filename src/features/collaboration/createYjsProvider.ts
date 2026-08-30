import YProvider from "y-partyserver/provider";
import type * as Y from "yjs";

export interface CollaborationProviderTicket {
  ticket: string;
  room: string;
  url: string;
}

/**
 * Both Misty Hosted and Self-hosted speak the same authenticated Yjs protocol.
 * Keeping construction behind this boundary lets deployment selection happen
 * in the ticket API without leaking provider details into Notes or Drawings.
 */
export function createYjsProvider(
  initial: CollaborationProviderTicket,
  doc: Y.Doc,
  party: "note-room" | "drawing-room",
  refresh: () => Promise<CollaborationProviderTicket>,
): YProvider {
  let unusedTicket = initial.ticket;
  return new YProvider(new URL(initial.url).host, initial.room, doc, {
    party,
    disableBc: true,
    params: async () => {
      if (unusedTicket) {
        const ticket = unusedTicket;
        unusedTicket = "";
        return { ticket };
      }
      return { ticket: (await refresh()).ticket };
    },
  });
}

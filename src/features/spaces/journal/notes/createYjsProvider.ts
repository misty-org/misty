import { ApiRequestError } from "@/api/client";
import YProvider from "y-partyserver/provider";
import type * as Y from "yjs";

interface CollaborationProviderTicket {
  ticket: string;
  room: string;
  url: string;
}

/** Why a doc or drawing stopped syncing for good: it was deleted, or this person lost access. */
export type CollaborationAccessLoss = "deleted" | "revoked";

/**
 * Whether this person can still reach a live doc or drawing. Once lost, the connection is closed
 * and stays closed: the provider no longer retries with tickets the server would refuse.
 */
export interface CollaborationAccess {
  readonly lost: CollaborationAccessLoss | null;
  subscribe(listener: () => void): () => void;
  /** Closes the connection for good, with the reason the person is shown. */
  lose(reason: CollaborationAccessLoss): void;
  /** Tries again with a fresh ticket, for a doc reopened after access was lost. */
  retry(): void;
}

/**
 * The collaboration Worker speaks an authenticated Yjs protocol.
 * Keeping construction behind this boundary lets deployment selection happen
 * in the ticket API without leaking provider details into Notes or Drawings.
 */
export function createYjsProvider(
  initial: CollaborationProviderTicket,
  doc: Y.Doc,
  party: "note-room" | "drawing-room",
  refresh: () => Promise<CollaborationProviderTicket>,
): { provider: YProvider; access: CollaborationAccess } {
  let unusedTicket = initial.ticket;
  let lost: CollaborationAccessLoss | null = null;
  const listeners = new Set<() => void>();
  const access: CollaborationAccess = {
    get lost() {
      return lost;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lose(reason) {
      if (lost) return;
      lost = reason;
      provider.disconnect();
      for (const listener of [...listeners]) listener();
    },
    retry() {
      if (!lost) return;
      lost = null;
      for (const listener of [...listeners]) listener();
      void provider.connect().catch(() => undefined);
    },
  };
  const provider: YProvider = new YProvider(new URL(initial.url).host, initial.room, doc, {
    party,
    disableBc: true,
    params: async () => {
      if (unusedTicket) {
        const ticket = unusedTicket;
        unusedTicket = "";
        return { ticket };
      }
      try {
        return { ticket: (await refresh()).ticket };
      } catch (error) {
        // The server won't give this person a ticket any more: the doc is gone or no longer
        // theirs. Stop here, rather than reconnecting forever with a ticket already used.
        if (error instanceof ApiRequestError && (error.status === 403 || error.status === 404))
          access.lose(error.status === 404 ? "deleted" : "revoked");
        throw error;
      }
    },
  });
  // The room closes a deleted doc's sockets with this code; every other close (an access
  // change, a superseded ticket) reconnects with a fresh ticket, which settles whether access
  // remains.
  provider.on("connection-close", (event: CloseEvent | null) => {
    if (event?.code === 1008 && event.reason === "resource_deleted") access.lose("deleted");
  });
  return { provider, access };
}

/** What a person is told about a doc or drawing they can no longer reach. */
export function collaborationAccessMessage(
  reason: CollaborationAccessLoss,
  kind: "doc" | "drawing",
): string {
  return reason === "deleted"
    ? `This ${kind} was deleted. Changes made here are no longer saved.`
    : `You no longer have access to this ${kind}. Changes made here are no longer saved.`;
}

import { ApiRequestError } from "@/api/client";
import YProvider from "y-partyserver/provider";
import type * as Y from "yjs";

interface CollaborationProviderTicket {
  ticket: string;
  room: string;
  url: string;
}

export type CollaborationAccessLoss = "deleted" | "revoked";

export interface CollaborationAccess {
  readonly lost: CollaborationAccessLoss | null;
  subscribe(listener: () => void): () => void;
  lose(reason: CollaborationAccessLoss): void;
  retry(): void;
}

export function createYjsProvider(
  initial: CollaborationProviderTicket,
  doc: Y.Doc,
  party: "note-room" | "code-room" | "app-room" | "file-room",
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
        if (error instanceof ApiRequestError && (error.status === 403 || error.status === 404))
          access.lose(error.status === 404 ? "deleted" : "revoked");
        throw error;
      }
    },
  });
  provider.on("connection-close", (event: CloseEvent | null) => {
    if (event?.code === 1008 && event.reason === "resource_deleted") access.lose("deleted");
  });
  return { provider, access };
}

export function collaborationAccessMessage(
  reason: CollaborationAccessLoss,
  kind: "doc" | "drawing" | "image",
): string {
  return reason === "deleted"
    ? `This ${kind} was deleted. Changes made here are no longer saved.`
    : `You no longer have access to this ${kind}. Changes made here are no longer saved.`;
}

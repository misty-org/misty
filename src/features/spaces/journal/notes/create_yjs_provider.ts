import { ApiRequestError, apiRequest } from "@/api/client";
import YProvider from "y-partyserver/provider";
import type * as Y from "yjs";

interface CollaborationProviderTicket {
  ticket: string;
  room: string;
  url: string;
}

export type CollaborationAccessLoss = "deleted" | "revoked";

export type CollaborationProblem = "too_large" | "room_full";

export interface CollaborationAccess {
  readonly lost: CollaborationAccessLoss | null;
  readonly problem: CollaborationProblem | null;
  readonly moved?: boolean;
  subscribe(listener: () => void): () => void;
  onProblem(listener: (problem: CollaborationProblem | null) => void): () => void;
  lose(reason: CollaborationAccessLoss): void;
  retry(): void;
}

export const TICKET_TIMEOUT_MS = 15_000;
const RETRY_FLOOR_MS = 100;
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 30_000;
const FULL_BASE_MS = 15_000;
const FULL_CAP_MS = 300_000;
const STEADY_MS = 10_000;

export function retryDelay(attempt: number, base = RETRY_BASE_MS, cap = RETRY_CAP_MS): number {
  return RETRY_FLOOR_MS + Math.random() * Math.min(cap, base * 2 ** Math.min(attempt, 20));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function requestCollaborationTicket<T>(path: string, body?: unknown): Promise<T> {
  return withTimeout(
    apiRequest<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    TICKET_TIMEOUT_MS,
    "The room's ticket didn't arrive in time.",
  );
}

export function isTransientTicketError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

export async function firstCollaborationTicket<T>(
  fetch: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch();
    } catch (error) {
      if (signal?.aborted || !isTransientTicketError(error)) throw error;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, retryDelay(attempt));
        const onAbort = () => {
          clearTimeout(timer);
          reject(error);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}

export function createYjsProvider(
  initial: CollaborationProviderTicket,
  doc: Y.Doc,
  party: "note-room" | "code-room" | "app-room" | "file-room",
  refresh: () => Promise<CollaborationProviderTicket>,
): { provider: YProvider; access: CollaborationAccess } {
  let unusedTicket = initial.ticket;
  let lost: CollaborationAccessLoss | null = null;
  let moved = false;
  let problem: CollaborationProblem | null = null;
  let destroyed = false;
  let stopped = false;
  let failures = 0;
  let fulls = 0;
  let refusedAccess = false;
  let upSince = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const problemListeners = new Set<(problem: CollaborationProblem | null) => void>();
  const setProblem = (next: CollaborationProblem | null) => {
    if (problem === next) return;
    problem = next;
    for (const listener of [...problemListeners]) listener(next);
  };
  const halted = () => destroyed || lost !== null || stopped;
  const connectNow = () => {
    timer = undefined;
    if (halted() || provider.ws) return;
    provider.connect().catch(() => {
      if (halted()) return;
      failures += 1;
      later(retryDelay(failures));
    });
  };
  const later = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(connectNow, delay);
  };
  const access: CollaborationAccess = {
    get lost() {
      return lost;
    },
    get problem() {
      return problem;
    },
    get moved() {
      return moved;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onProblem(listener) {
      problemListeners.add(listener);
      return () => problemListeners.delete(listener);
    },
    lose(reason) {
      if (lost) return;
      lost = reason;
      clearTimeout(timer);
      timer = undefined;
      provider.disconnect();
      for (const listener of [...listeners]) listener();
    },
    retry() {
      if (destroyed || (!lost && !stopped)) return;
      const wasLost = lost !== null;
      lost = null;
      moved = false;
      stopped = false;
      failures = 0;
      setProblem(null);
      if (wasLost) for (const listener of [...listeners]) listener();
      if (provider.ws) provider.shouldConnect = true;
      else connectNow();
    },
  };
  const host = new URL(initial.url).host;
  const sameRoom = (next: CollaborationProviderTicket) => {
    try {
      return next.room === initial.room && new URL(next.url).host === host;
    } catch {
      return false;
    }
  };
  const provider: YProvider = new YProvider(host, initial.room, doc, {
    party,
    disableBc: true,
    params: async () => {
      if (unusedTicket) {
        const ticket = unusedTicket;
        unusedTicket = "";
        return { ticket };
      }
      try {
        const next = await withTimeout(
          refresh(),
          TICKET_TIMEOUT_MS,
          "The room's ticket didn't arrive in time.",
        );
        if (halted()) throw new Error("The room was closed.");
        if (!sameRoom(next)) {
          moved = true;
          access.lose("deleted");
          throw new Error("The room moved.");
        }
        return { ticket: next.ticket };
      } catch (error) {
        if (error instanceof ApiRequestError && (error.status === 403 || error.status === 404))
          access.lose(error.status === 404 ? "deleted" : "revoked");
        throw error;
      }
    },
  });
  provider._reconnectWS = async () => {};
  const destroy = provider.destroy.bind(provider);
  provider.destroy = () => {
    destroyed = true;
    clearTimeout(timer);
    timer = undefined;
    destroy();
  };
  const forward = provider._awarenessUpdateHandler;
  provider.awareness.off("change", forward);
  provider._awarenessUpdateHandler = (changes, origin) => {
    if (origin !== provider) forward(changes, origin);
  };
  provider.awareness.on("change", provider._awarenessUpdateHandler);

  provider.on("sync", (done: boolean) => {
    if (!done) return;
    upSince = Date.now();
    fulls = 0;
    refusedAccess = false;
    if (problem === "room_full") setProblem(null);
  });
  provider.on("connection-close", (event: CloseEvent | null) => {
    const steady = upSince !== 0 && Date.now() - upSince >= STEADY_MS;
    upSince = 0;
    if (halted() || !provider.shouldConnect) return;
    const reason = event?.code === 1008 ? event.reason : "";
    if (reason === "resource_deleted" || reason === "ticket_room_mismatch") {
      access.lose("deleted");
      return;
    }
    if (reason === "access_revoked" || reason === "acl_superseded") {
      if (refusedAccess) {
        access.lose("revoked");
        return;
      }
      refusedAccess = true;
      later(retryDelay(0));
      return;
    }
    if (reason === "message_too_large") {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      setProblem("too_large");
      return;
    }
    if (reason === "room_full") {
      fulls += 1;
      setProblem("room_full");
      later(retryDelay(fulls, FULL_BASE_MS, FULL_CAP_MS));
      return;
    }
    failures = steady && !reason ? 0 : failures + 1;
    later(retryDelay(failures));
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

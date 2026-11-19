import { useCallback, useEffect, useState } from "react";
import {
  journalDocumentStatusMessage,
  parseJournalDocumentStatus,
} from "../../journal/collaborationStatus";
import type { CollaborationAccessLoss } from "../../journal/notes/createYjsProvider";
import { acquireDeckSession, releaseDeckSession, type DeckSession } from "../session";

export type DeckConnection = "connecting" | "connected" | "disconnected" | "error";

export interface DeckUser {
  id: string;
  name?: string | null;
  email?: string;
}

/** Who this person is to the others in the room, and the color their caret wears there. */
export interface DeckPresenceUser {
  id: string;
  name: string;
  color: string;
}

export function deckAccessMessage(reason: CollaborationAccessLoss): string {
  return reason === "deleted"
    ? "This deck was deleted. Changes made here are no longer saved."
    : "You no longer have access to this deck. Changes made here are no longer saved.";
}

/**
 * Joins a deck's room for one view: the session, whether its content has arrived, the
 * connection, and what the person is told when something goes wrong.
 */
export function useDeckRoom(
  spaceId: string,
  deckId: string,
  user: DeckUser | null,
  options?: { publishPresence?: boolean },
) {
  const [session, setSession] = useState<DeckSession | null>(null);
  const [connection, setConnection] = useState<DeckConnection>("connecting");
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lost, setLost] = useState<CollaborationAccessLoss | null>(null);
  const [attempt, setAttempt] = useState(0);
  const publishPresence = options?.publishPresence !== false;
  const userId = user?.id ?? "";
  const userName = user?.name || user?.email || "Collaborator";

  useEffect(() => {
    if (!deckId) return;
    let active = true;
    let detach: (() => void) | undefined;
    setSession(null);
    setConnection("connecting");
    setSynced(false);
    setError(null);
    setNotice(null);
    setLost(null);
    acquireDeckSession(spaceId, deckId, { publishPresence })
      .then((next) => {
        if (!active) return;
        next.access.retry();
        setSession(next);
        const awareness = next.provider.awareness;
        const presence: DeckPresenceUser = {
          id: userId,
          name: userName,
          color: presenceColor(userId),
        };
        const publish = () => {
          if (publishPresence && userId)
            awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), user: presence });
        };
        publish();
        const onSynced = (ready: boolean) => {
          if (!active) return;
          setSynced(ready);
          if (ready) setConnection("connected");
        };
        const onStatus = ({ status }: { status: string }) => {
          if (!active || next.access.lost) return;
          if (status === "connected") {
            publish();
            setConnection("connected");
            return;
          }
          const state = status === "disconnected" ? "disconnected" : "connecting";
          setConnection((current) => (current === "error" ? current : state));
        };
        const onConnectionError = () => {
          if (active) setConnection("error");
        };
        const onCustomMessage = (message: string) => {
          if (!active) return;
          const status = parseJournalDocumentStatus(message);
          if (status) setNotice(journalDocumentStatusMessage(status));
        };
        const onAccess = () => {
          if (!active) return;
          setLost(next.access.lost);
          if (next.access.lost) setConnection("disconnected");
        };
        const unsubscribeAccess = next.access.subscribe(onAccess);
        next.provider.on("synced", onSynced);
        next.provider.on("status", onStatus);
        next.provider.on("connection-error", onConnectionError);
        next.provider.on("custom-message", onCustomMessage);
        if (next.provider.synced) onSynced(true);
        detach = () => {
          unsubscribeAccess();
          next.provider.off("synced", onSynced);
          next.provider.off("status", onStatus);
          next.provider.off("connection-error", onConnectionError);
          next.provider.off("custom-message", onCustomMessage);
        };
      })
      .catch((cause) => {
        if (!active) return;
        setConnection("error");
        setError(cause instanceof Error ? cause.message : "Could not connect to this deck.");
      });
    return () => {
      active = false;
      detach?.();
      releaseDeckSession(spaceId, deckId, { publishPresence });
    };
  }, [spaceId, deckId, publishPresence, userId, userName, attempt]);

  const retry = useCallback(() => {
    if (!session) {
      setAttempt((current) => current + 1);
      return;
    }
    setConnection("connecting");
    session.provider.disconnect();
    void Promise.resolve(session.provider.connect()).catch(() => undefined);
  }, [session]);

  return {
    session,
    connection,
    synced,
    error,
    lost,
    /** Losing the deck outranks a size warning. */
    notice: lost ? deckAccessMessage(lost) : notice,
    /** The room's role, or viewer once access is lost. */
    role: lost ? ("viewer" as const) : session?.role,
    retry,
  };
}

const presenceColors = ["#e11d48", "#0284c7", "#16a34a", "#d97706", "#7c3aed", "#db2777"];

/** A person's caret color, the same for them on every device. */
export function presenceColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return presenceColors[hash % presenceColors.length];
}

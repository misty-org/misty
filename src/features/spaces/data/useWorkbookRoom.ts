import { useCallback, useEffect, useState } from "react";
import {
  journalDocumentStatusMessage,
  parseJournalDocumentStatus,
} from "../journal/collaborationStatus";
import { acquireWorkbookSession, releaseWorkbookSession, type WorkbookSession } from "./session";

export type WorkbookConnection = "connecting" | "connected" | "disconnected" | "error";

export interface WorkbookPerson {
  id: string;
  name?: string | null;
  email?: string;
}

/** What others see of this person in the room: who they are and where their selection is. */
export interface WorkbookPresenceUser {
  id: string;
  name: string;
}

function lostMessage(reason: "deleted" | "revoked"): string {
  return reason === "deleted"
    ? "This data was deleted. Changes made here are no longer saved."
    : "You no longer have access to this data. Changes made here are no longer saved.";
}

/**
 * Joins a workbook's live room for a view. `user` publishes this person's presence (the page
 * does); an embed passes null and stays unseen.
 */
export function useWorkbookRoom(spaceId: string, workbookId: string, user: WorkbookPerson | null) {
  const [session, setSession] = useState<WorkbookSession | null>(null);
  const [connection, setConnection] = useState<WorkbookConnection>("connecting");
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lost, setLost] = useState<"deleted" | "revoked" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const publishPresence = user !== null;
  const userId = user?.id ?? "";
  const userName = user?.name || user?.email || "Collaborator";

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    setSession(null);
    setConnection("connecting");
    setSynced(false);
    setError(null);
    setNotice(null);
    setLost(null);
    acquireWorkbookSession(spaceId, workbookId, { publishPresence })
      .then((next) => {
        if (!active) return;
        next.access.retry();
        setSession(next);
        setLost(next.access.lost);
        const publish = () => {
          if (!publishPresence) return;
          const awareness = next.provider.awareness;
          awareness.setLocalState({
            ...(awareness.getLocalState() ?? {}),
            user: { id: userId, name: userName } satisfies WorkbookPresenceUser,
          });
        };
        publish();
        const onAccess = () => {
          if (!active) return;
          setLost(next.access.lost);
          if (next.access.lost) setConnection("disconnected");
        };
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
        const onMessage = (message: string) => {
          if (!active) return;
          const status = parseJournalDocumentStatus(message);
          if (status) setNotice(journalDocumentStatusMessage(status));
        };
        const unsubscribeAccess = next.access.subscribe(onAccess);
        next.provider.on("synced", onSynced);
        next.provider.on("status", onStatus);
        next.provider.on("connection-error", onConnectionError);
        next.provider.on("custom-message", onMessage);
        if (next.provider.synced) onSynced(true);
        detach = () => {
          unsubscribeAccess();
          next.provider.off("synced", onSynced);
          next.provider.off("status", onStatus);
          next.provider.off("connection-error", onConnectionError);
          next.provider.off("custom-message", onMessage);
        };
      })
      .catch((cause) => {
        if (!active) return;
        setConnection("error");
        setError(cause instanceof Error ? cause.message : "Could not connect to this data.");
      });
    return () => {
      active = false;
      detach?.();
      releaseWorkbookSession(spaceId, workbookId, { publishPresence });
    };
  }, [spaceId, workbookId, publishPresence, userId, userName, attempt]);

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
    notice: lost ? lostMessage(lost) : notice,
    /** Why the workbook can no longer be reached, once it can't. */
    lost,
    /** Whether this person may change it: not once access is lost, and never as a viewer. */
    canEdit: Boolean(session && !lost && session.role !== "viewer"),
    retry,
  };
}

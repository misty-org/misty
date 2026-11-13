import { journalDocumentStatusMessage, parseJournalDocumentStatus } from "../..";
import { useEffect, useState } from "react";
import { collaborationAccessMessage, type CollaborationAccessLoss } from "../createYjsProvider";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
  type NoteCollaborationSession,
} from "../noteCollaboration";

/** Where a doc's live connection stands, for the notice over the editor. */
export type NoteConnectionState = "connecting" | "connected" | "disconnected" | "lost";

export function useNoteCollaborationRoom(spaceId: string, noteId: string) {
  const [session, setSession] = useState<NoteCollaborationSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<NoteConnectionState>("connecting");
  const [lost, setLost] = useState<CollaborationAccessLoss | null>(null);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    setSession(null);
    setError(null);
    setStatusNotice(null);
    setConnection("connecting");
    setLost(null);

    acquireNoteCollaborationSession(spaceId, noteId)
      .then((nextSession) => {
        if (!active) return;
        const { provider, access } = nextSession;
        // A doc reopened after its access was lost asks once more: it may be theirs again.
        access.retry();
        const onCustomMessage = (message: string) => {
          const status = parseJournalDocumentStatus(message);
          if (status) setStatusNotice(journalDocumentStatusMessage(status));
        };
        const onStatus = ({ status }: { status: string }) => {
          if (access.lost) return;
          setConnection(
            status === "connected"
              ? "connected"
              : status === "disconnected"
                ? "disconnected"
                : "connecting",
          );
        };
        const onAccess = () => {
          setLost(access.lost);
          if (access.lost) setConnection("lost");
          else if (provider.wsconnected) setConnection("connected");
        };
        provider.on("custom-message", onCustomMessage);
        provider.on("status", onStatus);
        const unsubscribe = access.subscribe(onAccess);
        detach = () => {
          provider.off("custom-message", onCustomMessage);
          provider.off("status", onStatus);
          unsubscribe();
        };
        onAccess();
        if (!access.lost && provider.wsconnected) setConnection("connected");
        setSession(nextSession);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Could not connect to this doc.");
      });

    return () => {
      active = false;
      detach?.();
      releaseNoteCollaborationSession(spaceId, noteId);
    };
  }, [noteId, spaceId]);

  // Losing the doc outranks a size warning; a dropped connection only shows while it lasts.
  const notice = lost
    ? collaborationAccessMessage(lost, "doc")
    : (statusNotice ??
      (connection === "disconnected"
        ? "Offline. Changes are kept here and sync when the connection is back."
        : null));
  return { session, error, notice, connection, lost };
}

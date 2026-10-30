import { journalDocumentStatusMessage, parseJournalDocumentStatus } from "@/features/journal";
import { isCollaborationOff } from "@/features/collaboration/localOnly";
import { useEffect, useState } from "react";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
  type NoteCollaborationSession,
} from "../noteCollaboration";

export function useNoteCollaborationRoom(spaceId: string, noteId: string) {
  const [session, setSession] = useState<NoteCollaborationSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The server runs without live co-editing: the editor works on this device alone.
  const [localOnly, setLocalOnly] = useState(false);

  useEffect(() => {
    let active = true;
    let detachStatus: (() => void) | undefined;
    setSession(null);
    setError(null);
    setNotice(null);
    setLocalOnly(false);

    acquireNoteCollaborationSession(spaceId, noteId)
      .then((nextSession) => {
        if (!active) return;
        const onCustomMessage = (message: string) => {
          const status = parseJournalDocumentStatus(message);
          if (status) setNotice(journalDocumentStatusMessage(status));
        };
        nextSession.provider.on("custom-message", onCustomMessage);
        detachStatus = () => nextSession.provider.off("custom-message", onCustomMessage);
        setSession(nextSession);
      })
      .catch((cause) => {
        if (!active) return;
        if (isCollaborationOff(cause)) setLocalOnly(true);
        else setError(cause instanceof Error ? cause.message : "Could not connect to this note.");
      });

    return () => {
      active = false;
      detachStatus?.();
      releaseNoteCollaborationSession(spaceId, noteId);
    };
  }, [noteId, spaceId]);

  return { session, error, notice, localOnly };
}

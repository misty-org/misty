import {
  journalDocumentStatusMessage,
  parseJournalDocumentStatus,
} from "@/features/journal/collaborationStatus";
import { useEffect, useRef, useState } from "react";
import type { DrawingSession } from "../drawingRuntime";
import type { DrawingConnectionState } from "../types";

export interface DrawingRoomServices {
  acquire(
    space: string,
    id: string,
    options?: { publishPresence?: boolean },
  ): Promise<DrawingSession>;
  release(space: string, id: string, options?: { publishPresence?: boolean }): void;
  subscribe?(space: string, id: string, listener: () => void): () => void;
  read?(id: string): DrawingSession | null;
}
export interface DrawingUser {
  id: string;
  name?: string | null;
  email?: string;
}
export function useDrawingRoomView(
  owner: DrawingRoomServices,
  spaceId: string,
  drawingId: string,
  user: DrawingUser,
  options?: { publishPresence?: boolean },
) {
  const [session, setSession] = useState<DrawingSession | null>(null);
  const [connection, setConnection] = useState<DrawingConnectionState>("connecting");
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const acquiredRef = useRef(false);
  const publishPresence = options?.publishPresence !== false;

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let detachProviderListeners: (() => void) | undefined;
    acquiredRef.current = true;
    setSession(null);
    setConnection("connecting");
    setSynced(false);
    setError(null);
    setNotice(null);

    let pending: Promise<DrawingSession>;
    try {
      pending = owner.acquire(spaceId, drawingId, { publishPresence });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect to this drawing.");
      return;
    }
    pending
      .then((nextSession) => {
        if (!active) return;
        setSession(owner.read?.(drawingId) ?? nextSession);
        unsubscribe = owner.subscribe?.(spaceId, drawingId, () => {
          if (active) {
            const session = owner.read?.(drawingId) ?? null;
            setSession(session);
            if (!session) {
              setSynced(false);
              setConnection("disconnected");
            }
          }
        });
        const awareness = nextSession.provider.awareness;
        const userPresence = {
          id: user.id,
          name: user.name || user.email || "Collaborator",
          color: collaborationColor(user.id),
        };
        const publishUserPresence = () => {
          if (publishPresence) {
            awareness.setLocalStateField("user", userPresence);
          }
        };
        publishUserPresence();

        const onSynced = (ready: boolean) => {
          if (!active) return;
          setSynced(ready);
          if (ready) setConnection("connected");
        };
        const onStatus = ({ status }: { status: string }) => {
          if (!active) return;
          if (status === "connected") {
            publishUserPresence();
            setConnection("connected");
          } else if (status === "disconnected") setConnection("disconnected");
          else setConnection("connecting");
        };
        const onConnectionError = () => {
          if (active) setConnection("error");
        };
        const onCustomMessage = (message: string) => {
          if (!active) return;
          const status = parseJournalDocumentStatus(message);
          if (status) setNotice(journalDocumentStatusMessage(status));
        };
        nextSession.provider.on("synced", onSynced);
        nextSession.provider.on("status", onStatus);
        nextSession.provider.on("connection-error", onConnectionError);
        nextSession.provider.on("custom-message", onCustomMessage);
        if (nextSession.provider.synced) onSynced(true);

        detachProviderListeners = () => {
          nextSession.provider.off("synced", onSynced);
          nextSession.provider.off("status", onStatus);
          nextSession.provider.off("connection-error", onConnectionError);
          nextSession.provider.off("custom-message", onCustomMessage);
        };
      })
      .catch((cause) => {
        if (!active) return;
        setConnection("error");
        setError(cause instanceof Error ? cause.message : "Could not connect to this drawing.");
      });

    return () => {
      active = false;
      detachProviderListeners?.();
      unsubscribe?.();
      if (acquiredRef.current) {
        acquiredRef.current = false;
        owner.release(spaceId, drawingId, { publishPresence });
      }
    };
  }, [owner, drawingId, publishPresence, spaceId, user.email, user.id, user.name]);

  return { session, connection, synced, error, notice };
}

function collaborationColor(id: string) {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const colors = [
    { background: "#fecdd3", stroke: "#e11d48" },
    { background: "#bae6fd", stroke: "#0284c7" },
    { background: "#bbf7d0", stroke: "#16a34a" },
    { background: "#fde68a", stroke: "#d97706" },
    { background: "#ddd6fe", stroke: "#7c3aed" },
    { background: "#fbcfe8", stroke: "#db2777" },
  ];
  return colors[hash % colors.length];
}

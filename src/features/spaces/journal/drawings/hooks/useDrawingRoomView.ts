import {
  journalDocumentStatusMessage,
  parseJournalDocumentStatus,
} from "../../collaborationStatus";
import { useEffect, useRef, useState } from "react";
import { collaborationAccessMessage } from "../../notes/createYjsProvider";
import type { DrawingSession } from "../drawingRuntime";
import type { DrawingConnectionState } from "../drawingTypes";

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
  const [lostNotice, setLostNotice] = useState<string | null>(null);
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
    setLostNotice(null);

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
        const access = nextSession.access;
        // A drawing reopened after its access was lost asks once more: it may be theirs again.
        access?.retry();
        // A drawing this person can no longer reach shows as view-only from that moment.
        const shown = (session: DrawingSession | null) =>
          session && access?.lost ? { ...session, role: "viewer" as const } : session;
        setSession(shown(owner.read?.(drawingId) ?? nextSession));
        unsubscribe = owner.subscribe?.(spaceId, drawingId, () => {
          if (active) {
            const session = owner.read?.(drawingId) ?? null;
            setSession(shown(session));
            if (!session) {
              setSynced(false);
              setConnection("disconnected");
            }
          }
        });
        const onAccess = () => {
          if (!active) return;
          setLostNotice(access?.lost ? collaborationAccessMessage(access.lost, "drawing") : null);
          if (access?.lost) setConnection("disconnected");
          setSession(shown(owner.read?.(drawingId) ?? nextSession));
        };
        const unsubscribeAccess = access?.subscribe(onAccess);
        const awareness = nextSession.provider.awareness;
        const userPresence = {
          id: user.id,
          name: user.name || user.email || "Collaborator",
          color: collaborationColor(user.id),
        };
        const publishUserPresence = () => {
          if (publishPresence) {
            // A field can't be set on an empty state, which a drawing reopened within its
            // cached connection has (`releaseDrawingSession`), so the whole state is set.
            awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), user: userPresence });
          }
        };
        publishUserPresence();

        const onSynced = (ready: boolean) => {
          if (!active) return;
          setSynced(ready);
          if (ready) setConnection("connected");
        };
        const onStatus = ({ status }: { status: string }) => {
          if (!active || access?.lost) return;
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
          unsubscribeAccess?.();
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

  // Losing the drawing outranks a size warning.
  return { session, connection, synced, error, notice: lostNotice ?? notice };
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

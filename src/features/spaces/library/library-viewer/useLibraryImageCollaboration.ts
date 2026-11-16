import { useAuth } from "@/features/account";
import { personTone } from "@/features/agents";
import {
  clearImageEdit,
  imageDocBase,
  imageDocParts,
  type ImageCollaboration,
  type ImagePerson,
} from "@/features/files";
import { useEffect, useMemo, useState } from "react";
import {
  collaborationAccessMessage,
  type CollaborationAccessLoss,
} from "../../journal/notes/createYjsProvider";
import {
  acquireImageSession,
  releaseImageSession,
  type ImageCollaborationSession,
} from "./imageCollaboration";

type Connection = ImageCollaboration["connection"];

export type LibraryImageLive =
  | { state: "opening" }
  /** No room for this image (an older server, or no connection): the edit is this window's. */
  | { state: "local" }
  | { state: "live"; collaboration: ImageCollaboration; session: ImageCollaborationSession };

/**
 * Opens a library image's live edit, where everyone editing it works on one shared edit. It is
 * ready as soon as the room's ticket is: the editor never waits for the room to connect, and
 * what is done before it does joins the room's edit when it arrives. If there is no room at all,
 * the editor works on its own instead.
 */
export function useLibraryImageCollaboration(
  spaceId: string,
  itemId: string,
  version: number,
  canEdit: boolean,
): LibraryImageLive {
  const { user } = useAuth();
  const me = useMemo<ImagePerson | null>(
    () =>
      user
        ? { id: user.id, name: user.username || user.email || "Someone", tone: personTone(user.id) }
        : null,
    [user],
  );
  const [session, setSession] = useState<ImageCollaborationSession | null>(null);
  const [failed, setFailed] = useState(false);
  /** Whether the room has sent what it holds; until then its edit's base isn't known. */
  const [synced, setSynced] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lost, setLost] = useState<CollaborationAccessLoss | null>(null);

  useEffect(() => {
    if (!me) {
      setFailed(true);
      return;
    }
    let active = true;
    let detach: (() => void) | undefined;
    setSession(null);
    setFailed(false);
    setSynced(false);
    setConnection("connecting");
    setLost(null);
    acquireImageSession(spaceId, itemId)
      .then((next) => {
        if (!active) return;
        next.access.retry();
        const onStatus = ({ status }: { status: string }) => {
          if (!active || next.access.lost) return;
          setConnection(
            status === "connected"
              ? "connected"
              : status === "disconnected"
                ? "disconnected"
                : "connecting",
          );
        };
        const onError = () => {
          if (active) setConnection("error");
        };
        const onAccess = () => {
          if (!active) return;
          setLost(next.access.lost);
          if (next.access.lost) setConnection("disconnected");
        };
        const onSynced = (done: boolean) => {
          if (active && done) setSynced(true);
        };
        next.provider.on("status", onStatus);
        next.provider.on("connection-error", onError);
        next.provider.on("synced", onSynced);
        const unsubscribeAccess = next.access.subscribe(onAccess);
        detach = () => {
          next.provider.off("status", onStatus);
          next.provider.off("connection-error", onError);
          next.provider.off("synced", onSynced);
          unsubscribeAccess();
        };
        if (next.provider.wsconnected) setConnection("connected");
        if (next.provider.synced) setSynced(true);
        // Open at once: the room's edit shows when it arrives, and edits made before then (or
        // while offline) join it.
        setSession(next);
      })
      .catch(() => {
        // No room for this image on this server: edit on its own.
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      detach?.();
      releaseImageSession(spaceId, itemId);
    };
  }, [itemId, me, spaceId]);

  // An edit left from before the image last changed is cleared: it was made on other pixels.
  // That is only known once the room has sent its edit.
  const role = session?.role;
  useEffect(() => {
    if (!session || !synced || role === "viewer" || !canEdit) return;
    const parts = imageDocParts(session.doc);
    const base = imageDocBase(parts);
    const current = String(version);
    if (base === null) {
      session.doc.transact(() => parts.meta.set("base", current), { image: "base" });
      return;
    }
    const made = Number(base);
    if (!Number.isFinite(made) || made < version) clearImageEdit(parts, current, { image: "base" });
  }, [canEdit, role, session, synced, version]);

  const notice = lost
    ? collaborationAccessMessage(lost, "image")
    : connection === "disconnected" || connection === "error"
      ? "Offline. Edits sync when the connection is back."
      : null;
  const collaboration = useMemo<ImageCollaboration | null>(
    () =>
      session && me
        ? {
            doc: session.doc,
            awareness: session.provider.awareness,
            me,
            readonly: session.role === "viewer" || !canEdit || Boolean(lost),
            connection,
            notice,
          }
        : null,
    [canEdit, connection, lost, me, notice, session],
  );

  if (failed) return { state: "local" };
  if (!session || !collaboration) return { state: "opening" };
  return { state: "live", collaboration, session };
}

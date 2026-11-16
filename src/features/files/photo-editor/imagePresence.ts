import type { ItemTone } from "@/shared/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { Mark, Point } from "./imageEdit";

/** Someone in the editor: a person, or an agent working on the image for one. */
export interface ImagePerson {
  id: string;
  name: string;
  tone: ItemTone;
  agent?: boolean;
}

/** What each person in the editor shares about themselves while they work. */
export interface ImagePeerState {
  user: ImagePerson;
  /** Where their pointer is over the image, in its own space; null when it is off it. */
  pointer?: Point | null;
  /** The marks they have picked. */
  selection?: string[];
  /** The mark they are drawing right now, before it is added. */
  draft?: Mark | null;
}

export interface ImagePeer extends ImagePeerState {
  clientId: number;
}

/**
 * An image edited live with others: the shared document, who is here, and the room's state. The
 * library opens it; the editor only reads and writes it.
 */
export interface ImageCollaboration {
  doc: Y.Doc;
  awareness: Awareness;
  me: ImagePerson;
  /** Only looking: a viewer's ticket, or access lost. */
  readonly: boolean;
  connection: "connecting" | "connected" | "disconnected" | "error";
  /** Something about the room the person should know, such as being offline or access lost. */
  notice?: string | null;
}

const validPerson = (value: unknown): value is ImagePerson =>
  Boolean(value) &&
  typeof (value as ImagePerson).id === "string" &&
  typeof (value as ImagePerson).name === "string" &&
  typeof (value as ImagePerson).tone === "string";

/** Everyone else in the editor now, one entry per window they have it open in. */
export function usePeers(awareness: Awareness | null): ImagePeer[] {
  const [peers, setPeers] = useState<ImagePeer[]>([]);
  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      return;
    }
    const read = () => {
      const next: ImagePeer[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const peer = state as Partial<ImagePeerState>;
        if (!validPerson(peer.user)) return;
        next.push({
          clientId,
          user: peer.user,
          pointer: peer.pointer ?? null,
          selection: Array.isArray(peer.selection)
            ? peer.selection.filter((id) => typeof id === "string")
            : [],
          draft: peer.draft && typeof peer.draft === "object" ? peer.draft : null,
        });
      });
      next.sort((a, b) => a.clientId - b.clientId);
      setPeers(next);
    };
    awareness.on("change", read);
    read();
    return () => awareness.off("change", read);
  }, [awareness]);
  return peers;
}

/** The people in the editor, once each, for the faces in the top bar. */
export function uniquePeople(peers: ImagePeer[]): ImagePerson[] {
  const seen = new Map<string, ImagePerson>();
  for (const peer of peers) if (!seen.has(peer.user.id)) seen.set(peer.user.id, peer.user);
  return [...seen.values()];
}

const pointerEveryMs = 40;

/**
 * Shares this person's presence: who they are while the editor is open, and where they point,
 * what they picked and what they are drawing as they work. The pointer goes out at most every
 * 40ms, so moving it never floods the room.
 */
export function usePublishPresence(awareness: Awareness | null, me: ImagePerson | null) {
  useEffect(() => {
    if (!awareness || !me) return;
    awareness.setLocalState({
      ...(awareness.getLocalState() ?? {}),
      user: me,
      pointer: null,
      selection: [],
      draft: null,
    });
    return () => {
      // Leaving the editor leaves the room's presence; the connection may stay open a while.
      awareness.setLocalState(null);
    };
  }, [awareness, me]);

  // Pointer and draft changes wait here and go out together, at most once per interval.
  const pending = useRef<Partial<Pick<ImagePeerState, "pointer" | "draft">>>({});
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [awareness],
  );
  const flush = useCallback(() => {
    timer.current = null;
    const fields = pending.current;
    pending.current = {};
    const state = awareness?.getLocalState();
    if (!awareness || !state) return;
    awareness.setLocalState({ ...state, ...fields });
  }, [awareness]);
  const queue = useCallback(
    (fields: Partial<Pick<ImagePeerState, "pointer" | "draft">>, now = false) => {
      pending.current = { ...pending.current, ...fields };
      if (now) {
        if (timer.current !== null) window.clearTimeout(timer.current);
        flush();
        return;
      }
      if (timer.current === null) timer.current = window.setTimeout(flush, pointerEveryMs);
    },
    [flush],
  );
  const publishPointer = useCallback((pointer: Point | null) => queue({ pointer }), [queue]);
  // A finished or dropped draft clears at once, so it never lingers on others' screens.
  const publishDraft = useCallback(
    (draft: Mark | null) => queue({ draft }, draft === null),
    [queue],
  );
  const publishSelection = useCallback(
    (ids: string[]) => {
      if (!awareness || !awareness.getLocalState()) return;
      awareness.setLocalStateField("selection", ids);
    },
    [awareness],
  );
  return useMemo(
    () => ({ publishPointer, publishSelection, publishDraft }),
    [publishDraft, publishPointer, publishSelection],
  );
}

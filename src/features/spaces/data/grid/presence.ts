import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { WorkbookPresenceUser } from "../useWorkbookRoom";

/** Where a person's selection is, by ids, so it stays on the same cells as rows move. */
export interface PresenceCursor {
  sheet: string;
  anchor: { r: string; c: string };
  focus: { r: string; c: string };
}

export interface Peer {
  clientId: number;
  user: WorkbookPresenceUser;
  cursor: PresenceCursor | null;
}

function readPeers(awareness: Awareness): Peer[] {
  const peers: Peer[] = [];
  const seen = new Set<string>();
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const user = (state as { user?: WorkbookPresenceUser }).user;
    if (!user?.id) return;
    const cursor = (state as { cursor?: PresenceCursor }).cursor ?? null;
    // One person in two windows shows once, at their latest selection.
    const key = `${user.id}:${cursor?.sheet ?? ""}`;
    if (seen.has(key) && !cursor) return;
    seen.add(key);
    peers.push({ clientId, user, cursor });
  });
  return peers;
}

/** The other people in the room, as their awareness changes. */
export function usePeers(awareness: Awareness | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      return;
    }
    const update = () => setPeers(readPeers(awareness));
    update();
    awareness.on("change", update);
    return () => awareness.off("change", update);
  }, [awareness]);
  return peers;
}

/** Publishes this person's selection, or clears it (a chart tab, a closed page). */
export function publishCursor(awareness: Awareness | null, cursor: PresenceCursor | null): void {
  if (!awareness) return;
  const state = awareness.getLocalState();
  if (!state) return;
  const current = (state as { cursor?: PresenceCursor | null }).cursor ?? null;
  if (JSON.stringify(current) === JSON.stringify(cursor)) return;
  awareness.setLocalStateField("cursor", cursor);
}

/** People in the room, once each, for the header's avatars. */
export function distinctPeople(peers: readonly Peer[]): WorkbookPresenceUser[] {
  const byId = new Map<string, WorkbookPresenceUser>();
  for (const peer of peers) if (!byId.has(peer.user.id)) byId.set(peer.user.id, peer.user);
  return [...byId.values()];
}

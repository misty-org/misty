import { useEffect, useState } from "react";
import type { DeckSession } from "../session";
import type { DeckPresenceUser } from "./useDeckRoom";

export interface DeckPeer {
  clientId: number;
  user: DeckPresenceUser;
  /** The slide they have open. */
  slideId: string | null;
}

/**
 * The other people in the deck and the slide each has open, and this person's own slide
 * published for them. Several tabs of one person count once.
 */
export function useDeckPresence(
  session: DeckSession | null,
  currentSlideId: string | null,
  selfId: string,
): DeckPeer[] {
  const [peers, setPeers] = useState<DeckPeer[]>([]);

  useEffect(() => {
    if (!session) return;
    const awareness = session.provider.awareness;
    const local = awareness.getLocalState();
    // Only once a view has said who this person is: a state with no user stays empty.
    if (local?.user) awareness.setLocalStateField("slide", currentSlideId);
  }, [session, currentSlideId]);

  useEffect(() => {
    if (!session) {
      setPeers([]);
      return;
    }
    const awareness = session.provider.awareness;
    const read = () => {
      const byUser = new Map<string, DeckPeer>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const user = (state as { user?: DeckPresenceUser }).user;
        if (!user?.id || user.id === selfId) return;
        const slideId = (state as { slide?: unknown }).slide;
        byUser.set(user.id, {
          clientId,
          user,
          slideId: typeof slideId === "string" ? slideId : null,
        });
      });
      setPeers([...byUser.values()]);
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [session, selfId]);

  return peers;
}

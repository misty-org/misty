import { useMemo } from "react";
import type { LiveRoom } from "./liveRoom";
import { useRoomVersion } from "./liveStore";
import type { LiveAwareness, LivePerson, LiveStep } from "./liveTypes";

/** Someone with the session open now, and the file they're in. */
export interface PresentPerson {
  id: string;
  name: string;
  path: string | null;
}

/** The people in the session now, from awareness: one entry each however many windows they have. */
export function presentPeople(room: LiveRoom, withMe: boolean): PresentPerson[] {
  const seen = new Map<string, PresentPerson>();
  room.provider.awareness.getStates().forEach((raw, client) => {
    const state = raw as LiveAwareness;
    const user = state.user;
    if (!user?.id || (!withMe && user.id === room.me.id)) return;
    const mine = client === room.doc.clientID;
    if (!seen.has(user.id) || mine)
      seen.set(user.id, { id: user.id, name: user.name, path: state.path ?? null });
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The session's doc as the sidebar and main area read it, painted again as it changes. */
export function useRoomView(room: LiveRoom | undefined) {
  const version = useRoomVersion(room);
  return useMemo(() => {
    if (!room)
      return {
        steps: [] as LiveStep[],
        people: [] as LivePerson[],
        present: [] as PresentPerson[],
      };
    return {
      steps: room.steps.toArray(),
      people: [...room.people.values()],
      present: presentPeople(room, true),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the doc's changes
  }, [room, version]);
}

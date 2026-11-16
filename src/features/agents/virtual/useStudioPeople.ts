import { useEffect, useMemo, useState } from "react";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import type { Actor } from "./studio/behaviour";
import { placeWords, useStudioOpen, useStudioRequests, useTeamMembers } from "./teamMembers";

/** How long a member who just came into the studio waves before settling. */
const WAVE_MS = 6000;

/**
 * The people side of the studio: says the person is in the Studio while it is open, so the
 * Space's other members see them here, and gives back the members here now (as figures for the
 * room) and the requests waiting for the person.
 */
export function useStudioPeople() {
  const spaceId = spacesGateway.maybe()?.windowSpace()?.id ?? "";
  const members = useTeamMembers((state) => state.members);
  const requests = useStudioRequests((state) => state.requests);
  const [arrivals, setArrivals] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => useStudioOpen.getState().enter(), []);
  useEffect(() => {
    const gateway = spacesGateway.maybe();
    if (!spaceId || !gateway) return;
    gateway.setPlace({ spaceId, place: "studio" });
    return () => gateway.leavePlace("studio");
  }, [spaceId]);

  // Someone who just came into the studio waves for a moment.
  useEffect(() => {
    const here = members.filter((member) => member.place === "studio");
    const fresh = here.filter((member) => !(member.userId in arrivals));
    const gone = Object.keys(arrivals).filter(
      (userId) => !here.some((member) => member.userId === userId),
    );
    if (!fresh.length && !gone.length) return;
    const at = Date.now();
    setNow(at);
    setArrivals((known) => {
      const next = { ...known };
      for (const userId of gone) delete next[userId];
      for (const member of fresh) next[member.userId] = at;
      return next;
    });
    const timer = window.setTimeout(() => setNow(Date.now()), WAVE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [members, arrivals]);

  const memberActors = useMemo<Actor[]>(
    () =>
      members
        .filter((member) => member.place === "studio")
        .map((member) => ({
          id: `member:${member.userId}`,
          name: member.name,
          owner: member.name,
          guest: true,
          kind: "member" as const,
          ownerId: member.userId,
          picture: member.picture,
          where: placeWords(member),
          arrived: now - (arrivals[member.userId] ?? 0) < WAVE_MS,
          state: "resting" as const,
          doing: "",
          doingCode: "",
        })),
    [members, arrivals, now],
  );
  return { spaceId, members, requests, memberActors };
}

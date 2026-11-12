import { useEffect, useMemo } from "react";
import { useStudioAgents, useTeammateAgents } from "@/features/agents";
import { useWindowSpace } from "../components/space-row/useWindowSpace";
import { useSpaceItemCreator } from "../overview/useSpaceItemCreator";
import { sendAgentStatuses } from "./createSpacesRealtimeActions";
import { doingLabel, memberAgentsIn, useMemberAgents } from "./memberAgents";

/** How often a status is repeated while nothing changes, so members who just arrived hear it. */
const REPEAT_EVERY = 30_000;

/**
 * Keeps a shared Space's members in step on what each other's agents are doing: it tells the
 * others what this person's agents are doing now, as fixed codes, and hands what the others say
 * to the views that show teammates. Nothing is sent for a Space nobody else is in.
 */
export function SpaceAgentsBroadcast() {
  const space = useWindowSpace();
  const spaceId = space?.id ?? "";
  const shared = Boolean(space?.is_shared);
  const { agents } = useStudioAgents();
  const person = useSpaceItemCreator(spaceId);
  const heard = useMemberAgents((state) => state.bySpace[spaceId]);
  const statuses = useMemo(
    () =>
      agents.map(({ agent, state, doingCode, files }) => ({
        id: agent.id,
        name: agent.name,
        state,
        doing: doingCode,
        ...(files.length ? { files } : {}),
      })),
    [agents],
  );
  const said = JSON.stringify(statuses);
  useEffect(() => {
    if (!spaceId || !shared) return;
    const send = () => sendAgentStatuses(spaceId, JSON.parse(said));
    send();
    const timer = window.setInterval(send, REPEAT_EVERY);
    return () => window.clearInterval(timer);
  }, [spaceId, shared, said]);
  useEffect(() => {
    const show = () =>
      useTeammateAgents.getState().show(
        memberAgentsIn({ bySpace: { [spaceId]: heard ?? {} } }, spaceId).map(
          ({ userId, agent }) => ({
            key: `${userId}:${agent.id}`,
            name: agent.name,
            owner: person(userId),
            state: agent.state,
            doing: doingLabel(agent.doing, agent.state),
            files: agent.state === "resting" ? [] : (agent.files ?? []),
          }),
        ),
      );
    show();
    // A member who goes quiet drops out without anything arriving to say so.
    const timer = window.setInterval(show, 20_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `person` is rebuilt every render
  }, [spaceId, heard]);
  return null;
}

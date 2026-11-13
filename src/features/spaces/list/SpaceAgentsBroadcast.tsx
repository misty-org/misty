import { useEffect, useMemo } from "react";
import { useMistyStore, useStudioAgents, useTeammateAgents } from "@/features/agents";
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
  const conversations = useMistyStore((state) => state.conversations);
  const statuses = useMemo(
    () => spaceAgentStatuses(agents, spaceId, conversations),
    [agents, spaceId, conversations],
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

/**
 * What this person's agents are doing, as told to one Space's members. Agents belong to the
 * person, not to a Space, so an agent busy with a chat in another Space is told as resting here:
 * its work and the files it is changing stay with the Space that work is for.
 */
export function spaceAgentStatuses(
  agents: readonly {
    agent: { id: string; name: string };
    state: "working" | "needs-you" | "resting";
    doingCode: string;
    files: string[];
    conversationId: string;
  }[],
  spaceId: string,
  conversations: readonly { id: string; spaceId?: string }[],
) {
  const spaceOf = new Map(conversations.map((chat) => [chat.id, chat.spaceId]));
  return agents.map(({ agent, state, doingCode, files, conversationId }) => {
    const here = state !== "resting" && spaceOf.get(conversationId) === spaceId;
    return {
      id: agent.id,
      name: agent.name,
      state: here ? state : ("resting" as const),
      doing: here ? doingCode : "",
      ...(here && files.length ? { files } : {}),
    };
  });
}

import { useEffect, useMemo, useState } from "react";
import {
  useMistyStore,
  useStudioAgents,
  useTeammateAgents,
  useThreadWork,
} from "@/features/agents";
import { useWindowSpace } from "../components/space-row/use_window_space";
import { useSpaceItemCreator } from "../overview/use_space_item_creator";
import { memberPicture } from "../members/member_pictures";
import { useSpacesStore } from "./use_spaces_store";
import { sendAgentStatuses } from "./create_spaces_realtime_actions";
import {
  doingLabel,
  memberAgentsIn,
  useMemberAgents,
  type MemberAgentStatus,
} from "./member_agents";

const REPEAT_EVERY = 30_000;

export function SpaceAgentsBroadcast() {
  const space = useWindowSpace();
  const spaceId = space?.id ?? "";
  const shared = Boolean(space?.is_shared);
  const { agents } = useStudioAgents();
  const person = useSpaceItemCreator(spaceId);
  const heard = useMemberAgents((state) => state.bySpace[spaceId]);
  const [faces, setFaces] = useState<Record<string, string | null>>({});
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  const conversations = useMistyStore((state) => state.conversations);
  const threads = useThreadWork((state) => state.byConversation);
  const statuses = useMemo(
    () =>
      withLanding(
        spaceAgentStatuses(agents, spaceId, conversations),
        spaceId,
        conversations,
        threads,
      ),
    [agents, spaceId, conversations, threads],
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
            userId,
            agentId: agent.id,
            name: agent.name,
            owner: person(userId),
            ownerPicture: faces[userId] ?? undefined,
            state: agent.state,
            doing: doingLabel(agent.doing, agent.state, agent.waiting),
            files: agent.state === "resting" ? [] : (agent.files ?? []),
          }),
        ),
      );
    show();
    const timer = window.setInterval(show, 20_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `person` is rebuilt every render
  }, [spaceId, heard, faces]);
  useEffect(() => {
    if (!spaceId || !shared || !members) return;
    let live = true;
    const owners = new Set(
      memberAgentsIn({ bySpace: { [spaceId]: heard ?? {} } }, spaceId).map(({ userId }) => userId),
    );
    for (const userId of owners) {
      if (userId in faces) continue;
      const version = members?.find((member) => member.user_id === userId)?.avatar_version ?? 0;
      void memberPicture(spaceId, userId, version).then((url) => {
        if (live) setFaces((known) => (userId in known ? known : { ...known, [userId]: url }));
      });
    }
    return () => {
      live = false;
    };
  }, [spaceId, shared, heard, faces, members]);
  return null;
}

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
  return agents.slice(0, 12).map(({ agent, state, doingCode, files, conversationId }) => {
    const here = state !== "resting" && spaceOf.get(conversationId) === spaceId;
    return {
      id: agent.id,
      name: agent.name,
      state: here ? state : ("resting" as const),
      doing: here ? doingCode : "",
      ...(here && files.length ? { files: files.slice(0, 5) } : {}),
    };
  });
}

export function withLanding(
  statuses: readonly MemberAgentStatus[],
  spaceId: string,
  conversations: readonly { id: string; agentId?: string }[],
  threads: Readonly<Record<string, { spaceId: string; state: string } | null>>,
): MemberAgentStatus[] {
  const landing = new Set<string | undefined>();
  const waiting = new Map<string | undefined, number>();
  for (const chat of conversations) {
    const thread = threads[chat.id];
    if (thread?.spaceId !== spaceId) continue;
    if (thread.state === "landing") landing.add(chat.agentId);
    if (thread.state === "held") waiting.set(chat.agentId, (waiting.get(chat.agentId) ?? 0) + 1);
  }
  return statuses.map((status) => {
    const queued = waiting.get(status.id) ?? 0;
    const counted = queued ? { ...status, waiting: queued } : status;
    return landing.has(status.id) ? { ...counted, state: "landing", doing: "files" } : counted;
  });
}

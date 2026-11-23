import {
  agentAccountId,
  loadRunEntry,
  LocalToolRejected,
  registerLocalTools,
  unregisterLocalTools,
  useMistyStore,
  useThreadWork,
  type LocalToolHandler,
} from "@/features/agents";
import { doingLabel, memberAgentsIn, useMemberAgents } from "./member_agents";
import { useSpacesStore } from "./use_spaces_store";

const SPACE_CLAIMS_TOOL = "space.claims";

export const spaceClaimsTool: LocalToolHandler = async ({ runId, input }) => {
  if (Object.keys(input).length)
    throw new LocalToolRejected("invalid_input", "space_claims takes no arguments.");
  const entry = await loadRunEntry(runId);
  const spaceId = entry?.spaceId ?? "";
  if (!spaceId)
    throw new LocalToolRejected(
      "no_space",
      "This chat isn't working in a Space, so there are no claims to show.",
    );
  const me = agentAccountId();
  const members = useSpacesStore.getState().membersBySpace[spaceId] ?? [];
  const nameOf = (userId: string) =>
    members.find((member) => member.user_id === userId)?.name?.trim() || "A member";
  const claims = memberAgentsIn(useMemberAgents.getState(), spaceId)
    .filter(({ userId, agent }) => userId !== me && agent.state !== "resting")
    .filter(({ agent }) => agent.files?.length)
    .map(({ userId, agent }) => ({
      agent: agent.name,
      person: nameOf(userId),
      doing: doingLabel(agent.doing, agent.state, agent.waiting),
      files: agent.files ?? [],
    }));
  const titles = new Map(
    useMistyStore.getState().conversations.map((chat) => [chat.id, chat.title] as const),
  );
  const yours = Object.values(useThreadWork.getState().byConversation)
    .filter((view) => view && view.spaceId === spaceId)
    .filter((view) => view!.conversationId !== entry?.conversationId)
    .filter((view) => view!.state === "working" || view!.state === "landing")
    .map((view) => ({
      thread: titles.get(view!.conversationId) || "A thread",
      folder: view!.folder,
      state: view!.state,
    }));
  if (claims.length || yours.length) return { claims, your_other_threads: yours };
  return {
    claims,
    your_other_threads: yours,
    note: "No other agent or thread is working in this Space right now.",
  };
};

export function registerSpaceClaimsTool(): () => void {
  registerLocalTools({ [SPACE_CLAIMS_TOOL]: spaceClaimsTool });
  return () => unregisterLocalTools([SPACE_CLAIMS_TOOL]);
}

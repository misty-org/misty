import { create } from "zustand";
import { spaceRequest } from "../api/api";

/**
 * What another member's computer says one of their agents is doing. The codes are fixed, so
 * nothing an agent wrote travels with it: the server drops anything else.
 */
export interface MemberAgentStatus {
  id: string;
  name: string;
  state: "working" | "needs-you" | "resting";
  /** The kind of work, as a code (`browser`, `shell`, `files`…); empty at rest. */
  doing: string;
  files?: string[];
}

/** One line of a Space's stored activity log. */
export interface AgentActivityLine {
  id: number;
  user_id: string;
  agent_id: string;
  name: string;
  state: MemberAgentStatus["state"];
  doing: string;
  created_at: string;
}

/** How long a member's last word stands. Their computer repeats it sooner while it is connected. */
const STALE_AFTER = 75_000;

interface MemberAgentsState {
  /** Each Space's other members' agents, by member, with when they were last heard from. */
  bySpace: Record<string, Record<string, { agents: MemberAgentStatus[]; at: number }>>;
  receive(spaceId: string, userId: string, agents: MemberAgentStatus[]): void;
}

export const useMemberAgents = create<MemberAgentsState>((set, get) => ({
  bySpace: {},
  receive(spaceId, userId, agents) {
    const space = { ...(get().bySpace[spaceId] ?? {}) };
    space[userId] = { agents, at: Date.now() };
    set({ bySpace: { ...get().bySpace, [spaceId]: space } });
  },
}));

/** The other members' agents in a Space that were heard from recently. */
export function memberAgentsIn(
  state: Pick<MemberAgentsState, "bySpace">,
  spaceId: string,
  now = Date.now(),
): { userId: string; agent: MemberAgentStatus }[] {
  return Object.entries(state.bySpace[spaceId] ?? {})
    .filter(([, heard]) => now - heard.at < STALE_AFTER)
    .flatMap(([userId, heard]) => heard.agents.map((agent) => ({ userId, agent })));
}

/** What a status code means, in a few plain words. */
export function doingLabel(doing: string, state: MemberAgentStatus["state"]): string {
  if (state === "needs-you") return "Waiting for its person";
  if (state === "resting") return "";
  return (
    {
      browser: "On a web page",
      web: "Searching the web",
      shell: "Running a command",
      files: "Working with files",
      space: "Working in the Space",
      computer: "Using the computer",
      app: "Using a connected app",
      agents: "Working with another agent",
      memory: "Remembering",
      thinking: "Thinking",
    }[doing] ?? "Working"
  );
}

export const agentActivityApi = {
  list: (spaceId: string) =>
    spaceRequest<{ activity: AgentActivityLine[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/agent-activity`,
    ),
};

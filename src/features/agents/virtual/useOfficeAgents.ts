import { useEffect, useMemo, useState } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { runtimeAiApi } from "../AgentsRuntime";
import type { MistyActivityEntry } from "../conversations/state/activity";
import { useAgentAccountId } from "../personal/agentAccount";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { watchAllRunEvents } from "../runs/local-run/localRunEvents";
import { doingOf, stepsOf } from "./doing";

export { doingOf };

/** Where an agent is in the room: at its desk working, at the door asking for its person, or resting. */
export type OfficeState = "working" | "needs-you" | "resting";

export interface OfficeAgent {
  agent: AgentProfile;
  state: OfficeState;
  /** What it is doing, in a few plain words; empty while resting. */
  doing: string;
  /** The same as a fixed code, which is all that is told to a Space's other members. */
  doingCode: string;
  /** The chat its latest run belongs to, to open when it is picked. */
  conversationId: string;
  /** What its latest run was asked to do; empty when it has not run. */
  task: string;
  /** The last few things that run did, newest first, in the same plain words. */
  steps: string[];
}

export function officeStateOf(state: string | undefined): OfficeState {
  if (state === "running" || state === "queued" || state === "awaiting_device") return "working";
  if (state === "awaiting_approval" || state === "awaiting_intervention") return "needs-you";
  return "resting";
}

/** Each agent's newest run, and where that puts it in the room. */
export function placeAgents(agents: AgentProfile[], entries: MistyActivityEntry[]): OfficeAgent[] {
  const managed = agents.find((agent) => agent.system_managed)?.id;
  const newest = new Map<string, MistyActivityEntry>();
  for (const entry of entries) {
    const owner = entry.agent_id || managed;
    if (!owner || entry.delegation_depth > 0) continue;
    const known = newest.get(owner);
    if (!known || entry.updated_at > known.updated_at) newest.set(owner, entry);
  }
  return agents
    .filter((agent) => agent.enabled)
    .map((agent) => {
      const entry = newest.get(agent.id);
      const state = officeStateOf(entry?.state);
      const doing = state === "working" && entry ? doingOf(entry) : { words: "", code: "" };
      return {
        agent,
        state,
        doing: state === "needs-you" ? "Needs you" : doing.words,
        doingCode: doing.code,
        conversationId: entry?.conversation_id ?? "",
        task: entry?.title ?? "",
        steps: entry ? stepsOf(entry) : [],
      };
    });
}

/** The person's agents and what each is doing now, kept current as runs report. */
export function useOfficeAgents(): { agents: OfficeAgent[]; loading: boolean } {
  const accountId = useAgentAccountId();
  const profiles = usePersonalAgentsStore((state) => state.agents);
  const profilesLoading = usePersonalAgentsStore((state) => state.loading);
  const [entries, setEntries] = useState<MistyActivityEntry[] | null>(null);
  useEffect(() => {
    void usePersonalAgentsStore.getState().load(accountId);
    let live = true;
    let timer: number | undefined;
    const refresh = () =>
      void runtimeAiApi
        .activity("")
        .then((result) => live && setEntries(result.entries))
        .catch(() => live && setEntries((known) => known ?? []));
    refresh();
    // Runs report many times a second; the room only needs to follow along.
    const stop = watchAllRunEvents(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 400);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      stop();
    };
  }, [accountId]);
  const agents = useMemo(() => placeAgents(profiles, entries ?? []), [profiles, entries]);
  return { agents, loading: entries === null || (profilesLoading && !profiles.length) };
}

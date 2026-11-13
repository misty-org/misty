import { offeredAgents } from "../personal/offeredAgents";
import { useEffect, useMemo, useState } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { runtimeAiApi } from "../AgentsRuntime";
import type { MistyActivityEntry } from "../conversations/state/activity";
import { useAgentAccountId } from "../personal/agentAccount";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { watchAllRunEvents } from "../runs/local-run/localRunEvents";
import { currentSpaceKey, useSpaceFolders } from "../engines/enginesApi";
import { doingOf, stepsOf, wordsOf } from "./doing";
import { claimedFiles, followRunWork, type RunWork, useRunWork } from "./runWork";

export { doingOf };

/** Where an agent is in the room: at its desk working, at the door asking for its person, or resting. */
export type StudioState = "working" | "needs-you" | "resting";

export interface StudioAgent {
  agent: AgentProfile;
  state: StudioState;
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
  /** How its latest run ended, while it is resting: done, failed, or nothing to show. */
  outcome: Outcome;
  /** When that run last reported, in ms; 0 when it has not run. */
  endedAt: number;
  /** The files its working run is changing, relative to the Space's linked folder: its claim,
   * which the Space's other members are told. Empty unless it is working. */
  files: string[];
}

/** How a run ended, as the room shows it: a finished one is cheered, a failed one is slumped over. */
export type Outcome = "done" | "failed" | "";

export function outcomeOf(state: string | undefined): Outcome {
  if (state === "completed") return "done";
  if (state === "failed") return "failed";
  return "";
}

export function studioStateOf(state: string | undefined): StudioState {
  if (state === "running" || state === "queued") return "working";
  if (state === "awaiting_approval" || state === "awaiting_intervention") return "needs-you";
  return "resting";
}

/** Each agent's newest run, and where that puts it in the room. */
export function placeAgents(
  agents: AgentProfile[],
  entries: MistyActivityEntry[],
  runs: Record<string, RunWork> = {},
  folders: readonly string[] = [],
  now = Date.now(),
): StudioAgent[] {
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
      const state = studioStateOf(entry?.state);
      const work = entry ? runs[entry.run_id] : undefined;
      const doing =
        state !== "working" || !entry
          ? { words: "", code: "" }
          : work?.tool
            ? wordsOf(work.tool)
            : doingOf(entry);
      return {
        agent,
        state,
        doing: state === "needs-you" ? "Needs you" : doing.words,
        doingCode: doing.code,
        conversationId: entry?.conversation_id ?? "",
        task: entry?.title ?? "",
        steps: entry ? stepsOf(entry) : [],
        outcome: state === "resting" ? outcomeOf(entry?.state) : "",
        endedAt: entry ? Date.parse(entry.updated_at) || 0 : 0,
        files: state === "resting" ? [] : claimedFiles(work, folders, now),
      };
    });
}

/** The person's agents and what each is doing now, kept current as runs report. */
export function useStudioAgents(): { agents: StudioAgent[]; loading: boolean } {
  const accountId = useAgentAccountId();
  const profiles = usePersonalAgentsStore((state) => state.agents);
  const profilesLoading = usePersonalAgentsStore((state) => state.loading);
  const [entries, setEntries] = useState<MistyActivityEntry[] | null>(null);
  const runs = useRunWork((state) => state.runs);
  const space = currentSpaceKey();
  const folders = useSpaceFolders((state) => state.folders[space]);
  // A claim lapses after a quiet spell, which no event announces.
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setMinute((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    followRunWork();
    if (space)
      void useSpaceFolders
        .getState()
        .load(space)
        .catch(() => undefined);
  }, [space]);
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
  // Misty's own agent is in the room only while it has work going.
  const agents = useMemo(
    () =>
      placeAgents(profiles, entries ?? [], runs, folders ?? []).filter(
        (placed) => offeredAgents([placed.agent]).length > 0 || placed.state !== "resting",
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `minute` only re-reads the clock
    [profiles, entries, runs, folders, minute],
  );
  return { agents, loading: entries === null || (profilesLoading && !profiles.length) };
}

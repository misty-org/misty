import { offeredAgents } from "../personal/offered_agents";
import { useEffect, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import type { AgentProfile } from "@/shared/schemas";
import { runtimeAiApi } from "../agents_runtime";
import type { MistyActivityEntry } from "../conversations/state/activity";
import { useAgentAccountId } from "../personal/agent_account";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { watchAllRunEvents } from "../runs/local-run/local_run_events";
import { useProjectFolders } from "../shared-folders/chat_folder";
import { doingOf, stepsOf, wordsOf } from "./doing";
import { claimedFiles, followRunWork, type RunWork, useRunWork } from "./run_work";

export type StudioState = "working" | "needs-you" | "resting";

export interface StudioAgent {
  agent: AgentProfile;
  state: StudioState;
  doing: string;
  doingCode: string;
  conversationId: string;
  runId: string;
  task: string;
  steps: string[];
  outcome: Outcome;
  result: string;
  endedAt: number;
  files: string[];
}

export type Outcome = "done" | "failed" | "";

function outcomeOf(state: string | undefined): Outcome {
  if (state === "completed") return "done";
  if (state === "failed") return "failed";
  return "";
}

function studioStateOf(state: string | undefined): StudioState {
  if (state === "running" || state === "queued") return "working";
  if (state === "awaiting_approval" || state === "awaiting_intervention") return "needs-you";
  return "resting";
}

function placeAgents(
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
        runId: entry?.run_id ?? "",
        task: entry?.title ?? "",
        steps: entry ? stepsOf(entry) : [],
        outcome: state === "resting" ? outcomeOf(entry?.state) : "",
        result: state === "resting" && entry?.state === "completed" ? (entry.result ?? "") : "",
        endedAt: entry ? Date.parse(entry.updated_at) || 0 : 0,
        files: state === "resting" ? [] : claimedFiles(work, folders, now),
      };
    });
}

const noEntries: readonly MistyActivityEntry[] = [];

export function useStudioAgents(): {
  agents: StudioAgent[];
  loading: boolean;
  entries: readonly MistyActivityEntry[];
} {
  const accountId = useAgentAccountId();
  const profiles = usePersonalAgentsStore((state) => state.agents);
  const profilesLoading = usePersonalAgentsStore((state) => state.loading);
  const activity = useCachedResource<MistyActivityEntry[]>(
    accountId ? `agents/activity:${accountId}` : null,
    () => runtimeAiApi.activity("").then((result) => result.entries),
  );
  const entries = activity.data ?? (activity.loading ? null : []);
  const { reload: reloadActivity } = activity;
  const runs = useRunWork((state) => state.runs);
  const projects = useProjectFolders();
  const folders = useMemo(() => projects?.map((project) => project.path), [projects]);
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setMinute((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    followRunWork();
  }, []);
  useEffect(() => {
    void usePersonalAgentsStore.getState().load(accountId);
    let timer: number | undefined;
    const refresh = () => void reloadActivity();
    const stop = watchAllRunEvents(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 400);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [accountId, reloadActivity]);
  const agents = useMemo(
    () =>
      placeAgents(profiles, entries ?? [], runs, folders ?? []).filter(
        (placed) => offeredAgents([placed.agent]).length > 0 || placed.state !== "resting",
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `minute` only re-reads the clock
    [profiles, entries, runs, folders, minute],
  );
  return {
    agents,
    loading: entries === null || (profilesLoading && !profiles.length),
    entries: entries ?? noEntries,
  };
}

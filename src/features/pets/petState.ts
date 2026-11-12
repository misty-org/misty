// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { MistyActivityEntry } from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";
import type { PetStatus } from "./petAtlas";

export type PetActivity =
  "idle" | "thinking" | "tool" | "command" | "waiting" | "failed" | "completed";

export interface PetStateSnapshot {
  /** Which agent this is about, so the pet can tell several working agents apart. */
  sessionKey: string | null;
  /** The agent's name; null when nothing is going on. */
  sessionName: string | null;
  status: PetStatus;
  lookDirection: number;
  activity: PetActivity;
}

/** How long a failed run keeps the pet looking upset, after it ends. */
const FAILED_SHOWS_MS = 20_000;

const COMMAND_TOOLS = /^(shell|bash|terminal|powershell|exec|run)\b|shell\.run|^Bash$/i;

function toolOf(entry: MistyActivityEntry): string {
  for (let index = entry.events.length - 1; index >= 0; index -= 1) {
    const tool = entry.events[index]?.toolName ?? entry.events[index]?.tool_name;
    if (tool) return tool;
  }
  return "";
}

/** What a working run is busy with, from its latest tool. */
function runningActivity(entry: MistyActivityEntry): PetActivity {
  const tool = toolOf(entry);
  if (!tool) return "thinking";
  return COMMAND_TOOLS.test(tool) ? "command" : "tool";
}

function snapshotOf(entry: MistyActivityEntry, name: string, now: number): PetStateSnapshot | null {
  const base = { sessionKey: entry.agent_id || entry.run_id, sessionName: name, lookDirection: 0 };
  switch (entry.state) {
    case "running":
    case "queued":
    case "awaiting_device":
      return { ...base, status: "running", activity: runningActivity(entry) };
    case "awaiting_approval":
    case "awaiting_intervention":
      return { ...base, status: "waiting", activity: "waiting" };
    case "failed": {
      const ended = Date.parse(entry.updated_at);
      return Number.isFinite(ended) && now - ended < FAILED_SHOWS_MS
        ? { ...base, status: "failed", activity: "failed" }
        : null;
    }
    default:
      return null;
  }
}

/**
 * One state for each of the person's agents with something going on, from each agent's newest
 * run. Sub-agents report through the run that started them, so they are left out. Finished runs
 * leave the list; `PetRuntime` shows a short "completed" as one leaves.
 */
export function derivePetStates(
  agents: AgentProfile[],
  entries: MistyActivityEntry[],
  now = Date.now(),
): PetStateSnapshot[] {
  const managed = agents.find((agent) => agent.system_managed)?.id;
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  const newest = new Map<string, MistyActivityEntry>();
  for (const entry of entries) {
    const owner = entry.agent_id || managed;
    if (!owner || entry.delegation_depth > 0) continue;
    const known = newest.get(owner);
    if (!known || entry.updated_at > known.updated_at) newest.set(owner, entry);
  }
  const states: PetStateSnapshot[] = [];
  for (const [owner, entry] of newest) {
    const state = snapshotOf(entry, names.get(owner) ?? "Agent", now);
    if (state) states.push({ ...state, sessionKey: owner });
  }
  return states;
}

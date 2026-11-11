import type { LaneFile, Readiness } from "./multirunApi";

/** The most agents one multi-run takes. Native code enforces the same number. */
export const maxLanes = 4;

interface ChoiceAgent {
  id: string;
  name: string;
  enabled: boolean;
  engine?: string;
}

interface ChoiceEngine {
  id: string;
  name: string;
  installed: boolean;
}

/** An agent in the start dialog's checklist, and why it can't be chosen when it can't. */
export interface LaneChoice<Agent> {
  agent: Agent;
  reason: string;
}

/**
 * The person's agents as the checklist shows them. Only an outside engine can be started in a
 * worktree, so an agent on Misty's own engine is listed but can't be chosen.
 */
export function laneChoices<Agent extends ChoiceAgent>(
  agents: readonly Agent[],
  engines: readonly ChoiceEngine[],
): LaneChoice<Agent>[] {
  return agents
    .filter((agent) => agent.enabled)
    .map((agent) => {
      const engine = engines.find((item) => item.id === agent.engine);
      const reason =
        !agent.engine || agent.engine === "misty"
          ? "Misty's engine has no worktrees"
          : !engine
            ? "Its engine has no adapter"
            : !engine.installed
              ? `${engine.name} isn't installed`
              : "";
      return { agent, reason };
    });
}

/** The chosen ids after a row is pressed: off if it was on, on if there is still room. */
export function toggleChoice(chosen: readonly string[], id: string): string[] {
  if (chosen.includes(id)) return chosen.filter((item) => item !== id);
  return chosen.length >= maxLanes ? [...chosen] : [...chosen, id];
}

export type LaneStatus = "working" | "waiting" | "finished" | "failed" | "stopped" | "missing";

interface LaneReply {
  state?: "pending" | "streaming" | "completed" | "failed" | "canceled";
  activity?: string;
}

/** Where a lane stands, read from its chat's reply. `undefined` is a chat that was deleted. */
export function laneStatus(reply: LaneReply | undefined): LaneStatus {
  if (!reply) return "missing";
  if (reply.state === "completed") return "finished";
  if (reply.state === "failed") return "failed";
  if (reply.state === "canceled") return "stopped";
  return reply.activity === "awaiting_approval" ? "waiting" : "working";
}

export const laneStatusLabels: Record<LaneStatus, string> = {
  working: "Working",
  waiting: "Needs your approval",
  finished: "Finished",
  failed: "Failed",
  stopped: "Stopped",
  missing: "Chat removed",
};

export const isLaneSettled = (status: LaneStatus) => status !== "working" && status !== "waiting";

/** A lane's changes in one line's worth of numbers. */
export function changeTotals(files: readonly Pick<LaneFile, "insertions" | "deletions">[]) {
  let [insertions, deletions] = [0, 0];
  for (const file of files) {
    insertions += file.insertions;
    deletions += file.deletions;
  }
  return { files: files.length, insertions, deletions };
}

/** What stands in the way of a multi-run, and the one thing to do about it. */
export function readinessNotice(
  folder: string,
  readiness: Readiness | null,
): { title: string; action: "link" | "retry" } | null {
  if (!folder)
    return { title: "Link a project folder to this Space to use multi-run", action: "link" };
  switch (readiness) {
    case "no_git":
      return { title: "Install Git on this computer to use multi-run", action: "retry" };
    case "not_repository":
      return { title: "This folder isn't a Git repository, so link one that is", action: "link" };
    case "not_top_level":
      return { title: "Link the top folder of this repository to use multi-run", action: "link" };
    case "no_commits":
      return { title: "Make a first commit in this folder, then check again", action: "retry" };
    default:
      return null;
  }
}

/** A chat's name in the sidebar: the task's first line, short enough for a row. */
export const laneTitle = (task: string) => (task.trim().split("\n")[0] ?? "").slice(0, 56);

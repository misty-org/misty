import type { AiInvocationEvent, AiProgressItem } from "@/features/ai-surface/types";

export type ProgressTool = Extract<AiProgressItem, { type: "tool" }>;
export type ProgressGroup =
  | { type: "note"; key: string; text: string }
  | { type: "tools"; key: string; tools: ProgressTool[] };

/**
 * Applies one live tool event to a streaming reply. Text the reply had so far
 * was Misty narrating before the tool, so it becomes a note in the timeline and
 * the reply starts over; the text after the last tool is the answer. Details,
 * durations and failure reasons land on the tool's own entry.
 */
export function withToolEvent(
  message: { content: string; progress?: AiProgressItem[] },
  event: Extract<AiInvocationEvent, { type: `tool.${string}` }>,
): { content: string; progress: AiProgressItem[] } {
  const progress = [...(message.progress ?? [])];
  const update = (patch: Partial<ProgressTool>) => ({
    content: message.content,
    progress: progress.map((item) =>
      item.type === "tool" && item.id === event.toolCallId ? { ...item, ...patch } : item,
    ),
  });
  if (event.type === "tool.detail") return update({ activity: event.activity });
  if (event.type !== "tool.started")
    return update({
      state: event.type === "tool.failed" ? "failed" : "completed",
      durationMs: event.durationMs,
      error: event.type === "tool.failed" ? event.error : undefined,
    });
  const note = message.content.trim();
  if (note) progress.push({ type: "note", text: note });
  if (!progress.some((item) => item.type === "tool" && item.id === event.toolCallId))
    progress.push({ type: "tool", id: event.toolCallId, name: event.toolName, state: "running" });
  return { content: "", progress };
}

/** A tool that never finished because the reply stopped. */
export function settleProgress(progress: AiProgressItem[] | undefined) {
  return progress?.map((item) =>
    item.type === "tool" && item.state === "running" ? { ...item, state: "failed" as const } : item,
  );
}

/** Consecutive tools fold into one group; notes stand between them. */
export function groupProgress(items: AiProgressItem[]): ProgressGroup[] {
  const groups: ProgressGroup[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (item.type === "note") groups.push({ type: "note", key: `note:${index}`, text: item.text });
    else if (last?.type === "tools") last.tools.push(item);
    else groups.push({ type: "tools", key: `tools:${item.id || index}`, tools: [item] });
  });
  return groups;
}

/** One row of a group's table: a step, with any failed tries of it folded in. */
export interface ProgressStep extends ProgressTool {
  attempts: number;
}

/** A failed call followed by the same call again reads as one step, "Tried 2×". */
export function stepsOf(tools: ProgressTool[]): ProgressStep[] {
  const steps: ProgressStep[] = [];
  for (const tool of tools) {
    const last = steps[steps.length - 1];
    if (
      last?.state === "failed" &&
      last.name === tool.name &&
      (last.activity?.detail ?? "") === (tool.activity?.detail ?? "")
    ) {
      steps[steps.length - 1] = {
        ...tool,
        activity: tool.activity ?? last.activity,
        attempts: last.attempts + 1,
      };
    } else steps.push({ ...tool, attempts: 1 });
  }
  return steps;
}

const verbs: Record<string, [running: string, done: string]> = {
  list: ["Listing", "Listed"],
  search: ["Searching", "Searched"],
  find: ["Finding", "Found"],
  query: ["Checking", "Checked"],
  read: ["Reading", "Read"],
  get: ["Reading", "Read"],
  open: ["Opening", "Opened"],
  navigate: ["Opening", "Opened"],
  look: ["Looking at", "Looked at"],
  inspect: ["Inspecting", "Inspected"],
  create: ["Creating", "Created"],
  add: ["Adding", "Added"],
  write: ["Writing", "Wrote"],
  update: ["Updating", "Updated"],
  edit: ["Editing", "Edited"],
  rename: ["Renaming", "Renamed"],
  move: ["Moving", "Moved"],
  delete: ["Deleting", "Deleted"],
  remove: ["Removing", "Removed"],
  click: ["Clicking in", "Clicked in"],
  type: ["Typing in", "Typed in"],
  send: ["Sending", "Sent"],
  invite: ["Inviting to", "Invited to"],
  schedule: ["Scheduling", "Scheduled"],
  unschedule: ["Unscheduling", "Unscheduled"],
  plan: ["Planning", "Planned"],
  fetch: ["Fetching", "Fetched"],
};

/** Code project tools read better as whole phrases than as verb + "code". */
const codePhrases: Record<string, [running: string, done: string, subject: string]> = {
  delegate: ["Handing", "Handed", "coding to your coding tool"],
  wait: ["Waiting for", "Waited for", "your coding tool"],
  read: ["Reading", "Read", "a file"],
  list: ["Listing", "Listed", "files"],
  find: ["Finding", "Found", "files"],
  search: ["Searching", "Searched", "files"],
  write: ["Writing", "Wrote", "a file"],
  edit: ["Editing", "Edited", "a file"],
  run: ["Running", "Ran", "a command"],
  start: ["Starting", "Started", "a process"],
  logs: ["Reading", "Read", "process output"],
  processes: ["Checking", "Checked", "processes"],
  stop: ["Stopping", "Stopped", "a process"],
  preview: ["Opening", "Opened", "a preview"],
};

/** Git tools in a project (docs/plans/agent-git-projects.md). */
const gitPhrases: Record<string, [running: string, done: string, subject: string]> = {
  status: ["Checking", "Checked", "Git status"],
  diff: ["Reviewing", "Reviewed", "changes"],
  log: ["Reading", "Read", "history"],
  commit: ["Committing", "Committed", "changes"],
  branch: ["Switching", "Switched", "branches"],
  push: ["Pushing", "Pushed", "to GitHub"],
  pull: ["Pulling", "Pulled", "from GitHub"],
  pull_request: ["Opening", "Opened", "a pull request"],
};

/** A tool name split into its verb and what it acts on, such as "Searched" and "web". */
export function toolParts(name: string, running: boolean): { verb: string; subject: string } {
  if (/finish[._]task$/.test(name))
    return { verb: running ? "Wrapping up" : "Wrapped up", subject: "" };
  const code = /^code[._](\w+)$/.exec(name)?.[1];
  if (code && codePhrases[code]) {
    const [ing, ed, subject] = codePhrases[code];
    return { verb: running ? ing : ed, subject };
  }
  const git = /^git[._](\w+)$/.exec(name)?.[1];
  if (git && gitPhrases[git]) {
    const [ing, ed, subject] = gitPhrases[git];
    return { verb: running ? ing : ed, subject };
  }
  const parts = name
    .replace(/^misty[._]/, "")
    .split(/[._]/)
    .filter(Boolean);
  const verbIndex = parts.findIndex((part) => verbs[part]);
  if (verbIndex >= 0) {
    const [ing, ed] = verbs[parts[verbIndex]];
    const subject = parts.filter((_, index) => index !== verbIndex).join(" ");
    return { verb: running ? ing : ed, subject };
  }
  return { verb: running ? "Using" : "Used", subject: parts.join(" ") || "a tool" };
}

/**
 * Plain words for a tool name such as "tabs.list" or "misty_notes_search":
 * "Listing tabs" while it runs, "Listed tabs" after. Unknown verbs fall back
 * to "Using …" and "Used …".
 */
export function toolLabel(name: string, running: boolean): string {
  const { verb, subject } = toolParts(name, running);
  return subject ? `${verb} ${subject}` : verb;
}

/** What a step acted on: its target when the server knows it, else its tool's subject. */
export function stepTarget(step: ProgressTool): string {
  return step.activity?.detail || toolParts(step.name, false).subject;
}

/** The right-hand note on a row: retries, the result, or how long it took. */
export function stepMeta(step: ProgressStep): string {
  if (step.state === "running") return "";
  if (step.attempts > 1) return `Tried ${step.attempts}×`;
  if (step.activity?.result) return step.activity.result;
  return step.durationMs && step.durationMs >= 1000 ? duration(step.durationMs) : "";
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
}

/**
 * The line a group folds into. While a step runs it names that step and its
 * target ("Reading nhs.uk"); afterwards it lists what was done ("Searched web,
 * read page"), never a count of tools.
 */
export function toolGroupSummary(tools: ProgressTool[]): string {
  const running = [...tools].reverse().find((tool) => tool.state === "running");
  if (running) {
    const { verb } = toolParts(running.name, true);
    return `${verb} ${stepTarget(running)}`.trim();
  }
  const labels = [...new Set(tools.map((tool) => toolLabel(tool.name, false)))];
  const shown = labels.slice(0, 3).map((label, index) => (index ? lowerFirst(label) : label));
  const more = labels.length - shown.length;
  return `${shown.join(", ")}${more ? `, and ${more} more` : ""}`;
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

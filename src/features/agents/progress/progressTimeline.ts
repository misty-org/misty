import type { AiInvocationEvent, AiProgressItem } from "../runs/invocations/invocationTypes";
import { companionReply } from "../tutor/cursor/companionReply";

export type ProgressTool = Extract<AiProgressItem, { type: "tool" }>;
type ProgressGroup =
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
  // An outside engine's own sub-agent rows nest under its Task (`view/engine/EngineSubagents`).
  if (event.type === "tool.started" && event.parentToolCallId)
    return { content: message.content, progress: message.progress ?? [] };
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
      // Misty's own runtime only knows a call's arguments once it ends.
      ...(event.args !== undefined ? { args: event.args } : {}),
      ...(event.result !== undefined ? { result: event.result } : {}),
      ...(event.path ? { path: event.path } : {}),
    });
  const note = message.content.trim();
  if (note) progress.push({ type: "note", text: note });
  if (!progress.some((item) => item.type === "tool" && item.id === event.toolCallId))
    progress.push({
      type: "tool",
      id: event.toolCallId,
      name: event.toolName,
      state: "running",
      ...(event.args !== undefined ? { args: event.args } : {}),
      ...(event.path ? { path: event.path } : {}),
    });
  return { content: "", progress };
}

/**
 * Applies the reply's text. A run that answered in text and then wrapped up
 * sends that same answer as its final text (with any "Still incomplete" list
 * after it), so the note the answer became when the wrap-up started is dropped:
 * the answer shows once, as the reply, and "Wrapped up" stays a quiet step.
 */
export function withAnswer(
  message: { progress?: AiProgressItem[] },
  text: string,
): { content: string; progress?: AiProgressItem[] } {
  const progress = message.progress ?? [];
  let index = progress.length - 1;
  while (index >= 0 && progress[index].type === "tool" && isFinishTool(progress[index])) index -= 1;
  const note = progress[index];
  const answer = text.trim();
  const repeated =
    index < progress.length - 1 &&
    note?.type === "note" &&
    (answer === note.text.trim() || answer.startsWith(`${note.text.trim()}\n\nStill incomplete:`));
  if (!repeated) return { content: text, progress: message.progress };
  return { content: text, progress: progress.filter((_, position) => position !== index) };
}

function isFinishTool(item: AiProgressItem) {
  return item.type === "tool" && /finish[._]task$|^agent[._]finish$/.test(item.name);
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
    // Pointing tags are for the cursor, never for reading.
    if (item.type === "note") {
      const text = companionReply(item.text).text;
      if (text) groups.push({ type: "note", key: `note:${index}`, text });
    } else if (last?.type === "tools") last.tools.push(item);
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
  plan: ["Planning", "Planned"],
  fetch: ["Fetching", "Fetched"],
};

/**
 * The app's words for what a tool acts on. Tools carry the agent's own names
 * people see the UI's labels.
 */
const uiSubjects: Record<string, string> = {
  "log.work": "notebook",
  file: "Library",
  integration: "apps",
  folder: "shared folder",
  "space.member": "members",
  "browser.tab": "tabs",
  note: "notes",
  drawing: "drawings",
  message: "messages",
  thread: "threads",
  space: "Spaces",
  agent: "agents",
  device: "signed-in sessions",
};

/**
 * Outside engines' own tool names (Claude Code, Codex, OpenCode and the like), matched whole and
 * without case: their running and done verbs, and what they act on when their row has no target.
 */
const engineTools: Record<string, [running: string, done: string, subject: string]> = {
  bash: ["Running", "Ran", "a command"],
  shell: ["Running", "Ran", "a command"],
  local_shell: ["Running", "Ran", "a command"],
  exec_command: ["Running", "Ran", "a command"],
  command: ["Running", "Ran", "a command"],
  bashoutput: ["Reading", "Read", "command output"],
  killshell: ["Stopping", "Stopped", "a command"],
  read: ["Reading", "Read", "a file"],
  view: ["Reading", "Read", "a file"],
  ls: ["Listing", "Listed", "files"],
  glob: ["Finding", "Found", "files"],
  grep: ["Searching", "Searched", "code"],
  edit: ["Editing", "Edited", "a file"],
  multiedit: ["Editing", "Edited", "a file"],
  apply_patch: ["Editing", "Edited", "files"],
  patch: ["Editing", "Edited", "files"],
  write: ["Writing", "Wrote", "a file"],
  notebookedit: ["Editing", "Edited", "a notebook"],
  webfetch: ["Fetching", "Fetched", "a page"],
  websearch: ["Searching", "Searched", "the web"],
  todowrite: ["Updating", "Updated", "tasks"],
  todoread: ["Reading", "Read", "tasks"],
  task: ["Running", "Ran", "a sub-agent"],
  agent: ["Running", "Ran", "a sub-agent"],
  skill: ["Using", "Used", "a skill"],
  exitplanmode: ["Proposing", "Proposed", "a plan"],
};

/** A tool name split into its verb and what it acts on, such as "Searched" and "web". */
export function toolParts(name: string, running: boolean): { verb: string; subject: string } {
  const engine = engineTools[name.toLowerCase()];
  if (engine) return { verb: running ? engine[0] : engine[1], subject: engine[2] };
  if (/finish[._]task$|^agent[._]finish$/.test(name))
    return { verb: running ? "Wrapping up" : "Wrapped up", subject: "" };
  if (/^agent[._]tool[._](use|load)$/.test(name))
    return { verb: running ? "Getting" : "Got", subject: "more tools" };
  if (/^log[._]work[._]checklist$/.test(name))
    return { verb: running ? "Updating" : "Updated", subject: "checklist" };
  const parts = name
    .replace(/^misty[._]/, "")
    .split(/[._]/)
    .filter(Boolean);
  const verbIndex = parts.findIndex((part) => verbs[part]);
  if (verbIndex >= 0) {
    const [ing, ed] = verbs[parts[verbIndex]];
    const rest = parts.filter((_, index) => index !== verbIndex);
    const subject = uiSubjects[rest.join(".")] ?? rest.join(" ");
    return { verb: running ? ing : ed, subject };
  }
  return {
    verb: running ? "Using" : "Used",
    subject: uiSubjects[parts.join(".")] ?? (parts.join(" ") || "a tool"),
  };
}

/**
 * Plain words for a tool name such as "browser.tab.list" or "misty_notes_search":
 * "Listing tabs" while it runs, "Listed tabs" after. Unknown verbs fall back
 * to "Using …" and "Used …".
 */
export function toolLabel(name: string, running: boolean): string {
  const { verb, subject } = toolParts(name, running);
  return subject ? `${verb} ${subject}` : verb;
}

/** What a step acted on: its target when the server knows it, else its tool's subject. */
export function stepTarget(step: ProgressTool): string {
  return step.activity?.detail || step.path || toolParts(step.name, false).subject;
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
    const { verb } = toolParts(running.name, false);
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

/** What kind of step a tool is, for its row's icon and the turn's summary. */
export type ToolKind =
  | "command"
  | "read"
  | "search"
  | "edit"
  | "web"
  | "browser"
  | "tasks"
  | "agent"
  | "delete"
  | "send"
  | "finish"
  | "other";

const kindWords: Array<[ToolKind, RegExp]> = [
  ["finish", /finish[._]task$|^agent[._]finish$/],
  [
    "command",
    /^(bash|shell|local_shell|exec_command|command|bashoutput|killshell)$|terminal|[._]run$|^run[._]/,
  ],
  ["tasks", /^(todowrite|todoread)$|checklist|[._]plan$|^plan[._]|exitplanmode/],
  ["agent", /^(task|agent)$|subagent|sub_agent|delegate/],
  ["browser", /browser|[._](click|type|navigate|screenshot)$/],
  ["web", /^(webfetch|websearch)$|web[._]?(search|fetch)|[._]fetch$|^fetch[._]/],
  ["delete", /(^|[._])(delete|remove)($|[._])/],
  [
    "edit",
    /^(edit|multiedit|apply_patch|patch|write|notebookedit)$|(^|[._])(create|add|write|update|edit|rename|move)($|[._])/,
  ],
  ["search", /^(grep|glob|ls)$|(^|[._])(search|find|query|list)($|[._])/],
  ["read", /^(read|view)$|(^|[._])(read|get|open|look|inspect)($|[._])/],
  ["send", /(^|[._])(send|invite)($|[._])/],
];

/** The kind of step a tool name is: a command, a read, a search, an edit and so on. */
export function toolKind(name: string): ToolKind {
  const plain = name.replace(/^misty[._]/, "").toLowerCase();
  return kindWords.find(([, pattern]) => pattern.test(plain))?.[0] ?? "other";
}

/** How the turn's summary counts a kind of step: "ran 2 commands", "read 3 files". */
const kindCounts: Partial<Record<ToolKind, [one: string, many: string]>> = {
  command: ["ran 1 command", "ran # commands"],
  read: ["read 1 file", "read # files"],
  search: ["searched", "searched # times"],
  edit: ["made 1 edit", "made # edits"],
  web: ["looked at the web", "looked at the web # times"],
  browser: ["used the browser", "used the browser # times"],
  agent: ["ran 1 sub-agent", "ran # sub-agents"],
  delete: ["deleted 1 thing", "deleted # things"],
  send: ["sent 1 message", "sent # messages"],
};

/**
 * A finished turn's line: what it did, counted by kind in the order the kinds first came up,
 * such as "Read 3 files · ran 2 commands · made 1 edit". Kinds with no count of their own add up
 * under "and N more steps".
 */
export function turnSummary(tools: ProgressTool[]): string {
  const counts = new Map<ToolKind, number>();
  let other = 0;
  for (const tool of tools) {
    const kind = toolKind(tool.name);
    if (kind === "finish" || kind === "tasks") continue;
    if (!kindCounts[kind]) {
      other += 1;
      continue;
    }
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, count]) => {
    const [one, many] = kindCounts[kind]!;
    return count === 1 ? one : many.replace("#", String(count));
  });
  if (other) parts.push(other === 1 ? "1 more step" : `${other} more steps`);
  if (!parts.length)
    return tools.length === 1 ? "Worked through 1 step" : `Worked through ${tools.length} steps`;
  return [
    lowerFirst(parts[0]).replace(/^./, (first) => first.toUpperCase()),
    ...parts.slice(1),
  ].join(" · ");
}

/** A step's duration as its row's end shows it: whole seconds, then minutes. */
export function stepDuration(ms: number | undefined): string {
  return ms && ms >= 1000 ? duration(ms) : "";
}

import type { AiInvocationEvent, AiProgressItem } from "../runs/invocations/invocation_types";
import { companionReply } from "../tutor/cursor/companion_reply";

export type ProgressTool = Extract<AiProgressItem, { type: "tool" }>;
type ProgressGroup =
  | { type: "note"; key: string; text: string }
  | { type: "tools"; key: string; tools: ProgressTool[] };

export function withToolEvent(
  message: { content: string; progress?: AiProgressItem[] },
  event: Extract<AiInvocationEvent, { type: `tool.${string}` }>,
): { content: string; progress: AiProgressItem[] } {
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

export function settleProgress(progress: AiProgressItem[] | undefined) {
  return progress?.map((item) =>
    item.type === "tool" && item.state === "running" ? { ...item, state: "failed" as const } : item,
  );
}

export function groupProgress(items: AiProgressItem[]): ProgressGroup[] {
  const groups: ProgressGroup[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (item.type === "note") {
      const text = companionReply(item.text).text;
      if (text) groups.push({ type: "note", key: `note:${index}`, text });
    } else if (last?.type === "tools") last.tools.push(item);
    else groups.push({ type: "tools", key: `tools:${item.id || index}`, tools: [item] });
  });
  return groups;
}

export interface ProgressStep extends ProgressTool {
  attempts: number;
}

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

const uiSubjects: Record<string, string> = {
  "log.work": "notebook",
  file: "Files",
  integration: "apps",
  folder: "shared folder",
  "space.member": "members",
  "browser.tab": "tabs",
  note: "notebooks",
  message: "messages",
  thread: "threads",
  space: "Spaces",
  agent: "agents",
  device: "signed-in sessions",
};

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

export function toolParts(name: string, running: boolean): { verb: string; subject: string } {
  const engine = engineTools[name.toLowerCase()];
  if (engine) return { verb: running ? engine[0] : engine[1], subject: engine[2] };
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) {
    const words = (text: string) => text.replace(/[_-]+/g, " ").trim();
    return { verb: running ? "Using" : "Used", subject: `${words(mcp[2])} from ${words(mcp[1])}` };
  }
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

export function toolLabel(name: string, running: boolean): string {
  const { verb, subject } = toolParts(name, running);
  return subject ? `${verb} ${subject}` : verb;
}

export function stepTarget(step: ProgressTool): string {
  return step.activity?.detail || step.path || toolParts(step.name, false).subject;
}

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

export function toolKind(name: string): ToolKind {
  const plain = name.replace(/^misty[._]/, "").toLowerCase();
  return kindWords.find(([, pattern]) => pattern.test(plain))?.[0] ?? "other";
}

const kindCounts: Partial<Record<ToolKind, [one: string, many: string]>> = {
  edit: ["made 1 edit", "made # edits"],
  delete: ["deleted 1 thing", "deleted # things"],
  command: ["ran 1 command", "ran # commands"],
  agent: ["ran 1 sub-agent", "ran # sub-agents"],
  send: ["sent 1 message", "sent # messages"],
  browser: ["used the browser", "used the browser # times"],
  web: ["looked at the web", "looked at the web # times"],
  read: ["read 1 file", "read # files"],
  search: ["searched", "searched # times"],
};
const kindWeight = Object.keys(kindCounts) as ToolKind[];

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
  const parts = [...counts]
    .sort(([a], [b]) => kindWeight.indexOf(a) - kindWeight.indexOf(b))
    .map(([kind, count]) => {
      const [one, many] = kindCounts[kind]!;
      return count === 1 ? one : many.replace("#", String(count));
    });
  if (other) parts.push(other === 1 ? "1 more step" : `${other} more steps`);
  if (!parts.length)
    return tools.length === 1 ? "Worked through 1 step" : `Worked through ${tools.length} steps`;
  const words = [
    lowerFirst(parts[0]).replace(/^./, (first) => first.toUpperCase()),
    ...parts.slice(1),
  ];
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function stepDuration(ms: number | undefined): string {
  return ms && ms >= 1000 ? duration(ms) : "";
}

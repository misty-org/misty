import type { AiInvocationEvent, AiProgressItem } from "../runs/invocations/invocation_types";
import { useRegistry } from "@/native/registry";
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
  if (event.type === "tool.detail") {
    const tool = progress.find(
      (item): item is ProgressTool => item.type === "tool" && item.id === event.toolCallId,
    );
    const input = event.activity.input;
    const args = isEmptyArgs(input) ? undefined : input;
    const path = tool?.path || (args ? pathOf(args) : undefined);
    return update({
      activity: { ...tool?.activity, ...event.activity },
      ...(args !== undefined ? { args } : {}),
      ...(path ? { path } : {}),
    });
  }
  if (event.type !== "tool.started")
    return update({
      state: event.type === "tool.failed" ? "failed" : "completed",
      durationMs: event.durationMs,
      error: event.type === "tool.failed" ? event.error : undefined,
      ...(event.args !== undefined ? { args: event.args } : {}),
      ...(event.result !== undefined ? { result: event.result } : {}),
      ...(event.path ? { path: event.path } : {}),
      ...(event.pictures?.length ? { pictures: event.pictures } : {}),
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

function isEmptyArgs(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length)
  );
}

function pathOf(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const fields = args as Record<string, unknown>;
  const path = fields.file_path ?? fields.path ?? fields.notebook_path;
  return typeof path === "string" && path ? path : undefined;
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
  run: ["Running", "Ran"],
  execute: ["Running", "Ran"],
  insert: ["Inserting", "Inserted"],
  set: ["Setting", "Set"],
  change: ["Changing", "Changed"],
  export: ["Exporting", "Exported"],
  play: ["Playing", "Played"],
  pause: ["Pausing", "Paused"],
  undo: ["Undoing", "Undid"],
  bake: ["Running", "Ran"],
  fill: ["Filling in", "Filled in"],
  recall: ["Recalling", "Recalled"],
  close: ["Closing", "Closed"],
  use: ["Using", "Used"],
};

const screenTools: Record<string, [running: string, done: string]> = {
  read: ["Reading", "Read"],
  look: ["Looking at", "Looked at"],
  click: ["Clicking in", "Clicked in"],
  hover: ["Pointing in", "Pointed in"],
  drag: ["Dragging in", "Dragged in"],
  type: ["Typing in", "Typed in"],
  fill: ["Filling in fields in", "Filled in fields in"],
  select: ["Choosing in", "Chose in"],
  key: ["Pressing keys in", "Pressed keys in"],
  scroll: ["Scrolling", "Scrolled"],
  wait: ["Waiting on", "Waited on"],
  dialog: ["Answering a dialog in", "Answered a dialog in"],
  upload: ["Handing files to", "Handed files to"],
  steps: ["Working in", "Worked in"],
  console: ["Reading the console of", "Read the console of"],
  history: ["Going back in", "Went back in"],
};

const serverPrefixes = /^(claude_ai_|plugin_[a-z0-9-]+_)/i;

const plainWords = (text: string) => text.replace(/[_.-]+/g, " ").trim();

function serverName(server: string) {
  const words = plainWords(server.replace(serverPrefixes, ""));
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function appOfWire(rest: string): { name: string; tool: string } | null {
  const apps = useRegistry.getState().apps as { id?: unknown; name?: unknown }[];
  let best: { name: string; tool: string; length: number } | null = null;
  for (const app of apps) {
    if (typeof app.id !== "string" || typeof app.name !== "string") continue;
    const wire = `${app.id.replace(/-/g, "_")}_`;
    if (rest.startsWith(wire) && (!best || wire.length > best.length))
      best = { name: app.name, tool: rest.slice(wire.length), length: wire.length };
  }
  if (best) return { name: best.name, tool: best.tool };
  const screen = /^(.+?)_(screen_[a-z]+)$/.exec(rest);
  if (screen) return { name: plainWords(screen[1]), tool: screen[2] };
  const split = /^([^_]+)_(.+)$/.exec(rest);
  return split ? { name: plainWords(split[1]), tool: split[2] } : null;
}

function inPlace(tool: string, place: string, running: boolean, args?: unknown) {
  const parts = plainWords(tool).split(" ").filter(Boolean);
  const verbIndex = parts.findIndex((part) => verbs[part]);
  const command =
    args && typeof args === "object" && typeof (args as { command?: unknown }).command === "string"
      ? plainWords((args as { command: string }).command)
      : "";
  if (verbIndex < 0)
    return {
      verb: running ? "Using" : "Used",
      subject: `${parts.join(" ") || "a tool"} in ${place}`,
    };
  const [ing, ed] = verbs[parts[verbIndex]];
  const rest = parts.filter((_, index) => index !== verbIndex).join(" ");
  const what = command || rest;
  return { verb: running ? ing : ed, subject: what ? `${what} in ${place}` : `in ${place}` };
}

function mcpParts(server: string, tool: string, running: boolean, args?: unknown) {
  if (server !== "misty") return inPlace(tool, serverName(server), running, args);
  const app = tool.startsWith("app_") ? appOfWire(tool.slice(4)) : null;
  if (app) {
    const screen = /^screen_([a-z]+)$/.exec(app.tool);
    const known = screen ? screenTools[screen[1]] : undefined;
    if (known) return { verb: running ? known[0] : known[1], subject: app.name };
    return inPlace(app.tool, app.name, running, args);
  }
  return null;
}

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
  screen: "a browser tab",
  "browser.form": "a form",
  "browser.snapshot": "a page",
  "browser.steps": "steps on a page",
  "browser.run": "a program on a page",
  "browser.visual": "a page's picture",
  "browser.wait.for": "a page",
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
  toolsearch: ["Loading", "Loaded", "tools"],
  exitplanmode: ["Proposing", "Proposed", "a plan"],
};

export function toolParts(
  name: string,
  running: boolean,
  args?: unknown,
): { verb: string; subject: string } {
  const engine = engineTools[name.toLowerCase()];
  if (engine) return { verb: running ? engine[0] : engine[1], subject: engine[2] };
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) {
    const parts = mcpParts(mcp[1], mcp[2], running, args);
    if (parts) return parts;
    return toolParts(mcp[2], running, args);
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

export function toolLabel(name: string, running: boolean, args?: unknown): string {
  const { verb, subject } = toolParts(name, running, args);
  return subject ? `${verb} ${subject}` : verb;
}

function shortToolName(server: string, tool: string): string {
  if (server !== "misty") return `${serverName(server)} ${plainWords(tool)}`;
  const app = tool.startsWith("app_") ? appOfWire(tool.slice(4)) : null;
  if (app) return `${app.name} ${plainWords(app.tool)}`;
  return plainWords(tool.replace(/^misty_/, ""));
}

const plainToolNames = (text: string) =>
  text.replace(/mcp__([\w.-]+?)__([\w.-]+)/g, (_, server: string, tool: string) =>
    shortToolName(server, tool),
  );

function plainDetail(name: string, detail: string): string {
  if (name.toLowerCase() !== "toolsearch") return plainToolNames(detail);
  const select = /^select:(.*)$/i.exec(detail.trim());
  if (!select) return `tools for ${plainToolNames(detail)}`;
  return select[1]
    .split(",")
    .map((each) => plainToolNames(each.trim()))
    .filter(Boolean)
    .join(", ");
}

export function stepTarget(step: ProgressTool): string {
  const detail = step.activity?.detail;
  if (detail) return plainDetail(step.name, detail);
  return step.path || toolParts(step.name, false, step.args).subject;
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
  const labels = [...new Set(tools.map((tool) => toolLabel(tool.name, false, tool.args)))];
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

export function stepDuration(ms: number | undefined): string {
  return ms && ms >= 1000 ? duration(ms) : "";
}

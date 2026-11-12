/**
 * Turns a run's recorded steps into short, plain sentences ("Opened GitHub", "Edited src/app.ts"),
 * and decides which calls are housekeeping that a person needn't see as steps. Every sentence is
 * built here from what native code recorded; nothing a model wrote is shown.
 *
 * The folding rules follow BrowserOS's `lib/step-sentences.ts`
 * (https://github.com/browseros-ai/BrowserOS, AGPL-3.0-or-later; see NOTICE).
 */
import type { RunStep } from "./activityApi";

export type StepVerb =
  | "open"
  | "read"
  | "click"
  | "type"
  | "run"
  | "write"
  | "search"
  | "ask"
  | "plan"
  | "delegate"
  | "app"
  | "other";

export interface DescribedStep {
  sentence: string;
  verb: StepVerb;
  /** The steps this one stands for: repeats and checks fold into the step before. */
  seqs: number[];
  at: number;
  /** The latest picture among the folded steps. */
  picture: string;
  failed: boolean;
  running: boolean;
  hidden: boolean;
  nested: boolean;
  /** The page or file the step worked on, for folding a check into the step it checks. */
  place: string;
}

/** Misty's tool namespaces, as an outside engine sees them over MCP (`browser_navigate`). */
const namespaces = [
  "browser",
  "file",
  "folder",
  "note",
  "drawing",
  "message",
  "thread",
  "space",
  "shell",
  "web",
  "search",
  "computer",
  "screen",
  "agent",
  "integration",
  "app",
  "device",
  "log",
  "schedule",
  "artifact",
];

/** A tool's name as the rules read it: no MCP server prefix, lower case, Misty's tools dotted. */
export function toolKey(tool: string): string {
  const bare = (tool.split("__").pop() ?? tool).trim().toLowerCase();
  const underscore = bare.indexOf("_");
  if (!bare.includes(".") && underscore > 0 && namespaces.includes(bare.slice(0, underscore))) {
    return `${bare.slice(0, underscore)}.${bare.slice(underscore + 1)}`;
  }
  return bare;
}

/** Engines' tools that run a snippet of code rather than a shell command. */
const codeTools = ["js", "javascript", "node", "python", "code_interpreter", "repl"];

/** Calls that only set up or check the agent's own state. */
const housekeeping = new Set([
  "ask_misty",
  "misty_wait",
  "agent.wait",
  "agent.list",
  "bashoutput",
  "killshell",
  "killbash",
  "todoread",
  "computer.screenshot",
  "computer.wait",
  "computer.list_displays",
  "computer.get_app_state",
  "browser.session",
  "browser.wait_for",
  "device.list",
  "log.work.read",
  "integration.schemas",
  "integration.connected",
  "space.list",
  "space.member.list",
  "space.member.resolve",
  "listmcpresourcestool",
  "readmcpresourcetool",
]);

export function isHousekeeping(tool: string): boolean {
  const key = toolKey(tool);
  return housekeeping.has(key) || key.startsWith("browser.downloads");
}

const httpAddress = (text: string) => /^https?:\/\//i.test(text);

export function hostOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const shorten = (text: string, most = 60) =>
  text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text;

/** A path as the person would name it: relative to the linked folder, or just its file name. */
export function fileLabel(path: string, folder = ""): string {
  const clean = path.replace(/\\/g, "/");
  const root = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && clean.startsWith(`${root}/`)) return shorten(clean.slice(root.length + 1), 70);
  if (!clean.startsWith("/") && !/^[a-z]:\//i.test(clean)) return shorten(clean, 70);
  return shorten(clean.split("/").filter(Boolean).pop() ?? clean, 70);
}

function pageLabel(step: Pick<RunStep, "target" | "title">): string {
  if (step.title.trim()) return shorten(step.title.trim());
  if (httpAddress(step.target)) return hostOf(step.target) || "a page";
  return "";
}

/** What kind of thing a tool does. */
export function verbOf(tool: string): StepVerb {
  const key = toolKey(tool);
  const [space, action = ""] = key.includes(".")
    ? [key.slice(0, key.indexOf(".")), key.slice(key.indexOf(".") + 1)]
    : ["", key];
  if (space === "browser") {
    if (action === "navigate") return "open";
    if (["act", "click", "interact"].includes(action)) return "click";
    if (["type", "fill_form", "upload"].includes(action)) return "type";
    if (action === "request_user_action") return "ask";
    if (["run", "steps", "skill", "eval"].includes(action)) return "other";
    return "read";
  }
  if (space === "computer")
    return action.includes("type") || action.includes("key") ? "type" : "click";
  if (space === "file" || space === "folder" || space === "drawing") {
    return /read|list|search/.test(action)
      ? action.includes("search")
        ? "search"
        : "read"
      : "write";
  }
  if (space === "note" || space === "message" || space === "thread") {
    return /read|search|list/.test(action)
      ? action.includes("search")
        ? "search"
        : "read"
      : "write";
  }
  if (space === "shell") return "run";
  if (space === "web") return action.includes("search") ? "search" : "read";
  if (space === "search") return "search";
  if (space === "screen") return "read";
  if (space === "agent") return "delegate";
  if (space === "integration" || space === "app") return "app";
  if (space) return "other";
  // Outside engines' own tools.
  if (["read", "read_file", "view", "cat", "ls", "list", "list_dir", "notebookread"].includes(key))
    return "read";
  if (
    [
      "write",
      "edit",
      "multiedit",
      "notebookedit",
      "apply_patch",
      "patch",
      "str_replace",
      "create_file",
      "replace",
      "write_file",
    ].includes(key)
  )
    return "write";
  if (
    ["bash", "shell", "exec_command", "local_shell", "run_shell_command", "terminal"].includes(key)
  )
    return "run";
  if (codeTools.includes(key)) return "run";
  if (
    ["grep", "glob", "find", "search", "codebase_search", "file_search", "toolsearch"].includes(key)
  )
    return "search";
  if (["webfetch", "web_fetch", "fetch"].includes(key)) return "read";
  if (["websearch", "web_search", "web_search_preview"].includes(key)) return "search";
  if (["task", "agent", "subagent", "spawn_agent", "delegate"].includes(key)) return "delegate";
  if (["todowrite", "update_plan", "exitplanmode", "plan"].includes(key)) return "plan";
  if (["askuserquestion", "ask_user", "request_user_input"].includes(key)) return "ask";
  return "other";
}

/** One step as a past-tense sentence. `page` is the page the run was on, for calls that name none. */
export function describeStep(
  step: RunStep,
  options: { folder?: string; page?: string } = {},
): string {
  const key = toolKey(step.tool);
  const page = pageLabel(step) || options.page || "a page";
  const file =
    step.target && !httpAddress(step.target) ? fileLabel(step.target, options.folder) : "";
  const action = key.slice(key.indexOf(".") + 1);
  if (key.startsWith("browser.")) {
    if (action === "navigate") return `Opened ${page}`;
    if (action === "act" || action === "click" || action === "interact")
      return `Clicked on ${page}`;
    if (action === "type") return `Typed into ${page}`;
    if (action === "fill_form") return `Filled in a form on ${page}`;
    if (action === "upload") return `Attached a file on ${page}`;
    if (action === "request_user_action") return `Asked you for help on ${page}`;
    if (action === "find") return `Found something on ${page}`;
    if (action === "extract") return `Copied what it needed from ${page}`;
    if (action === "visual") return `Looked at ${page}`;
    if (action === "close" || action.endsWith("close")) return `Closed ${page}`;
    if (action === "skill") return `Used a saved routine on ${page}`;
    if (["run", "steps", "eval"].includes(action)) return `Worked on ${page}`;
    return `Read ${page}`;
  }
  if (key.startsWith("computer.")) {
    if (action.includes("type") || action.includes("key")) return "Typed on the computer";
    if (action.includes("scroll")) return "Scrolled on the computer";
    return "Used the computer";
  }
  if (key === "screen.look") return "Looked at your screen";
  if (key.startsWith("file.") || key.startsWith("folder.")) {
    const name = file || "a file";
    if (action.includes("search")) return "Searched the Space's files";
    if (key.startsWith("folder."))
      return action.includes("list") ? `Looked through ${file || "a folder"}` : `Read ${name}`;
    if (action.includes("read")) return `Read ${name}`;
    if (action.includes("create")) return `Created ${name}`;
    if (action.includes("delete")) return `Deleted ${name}`;
    if (action.includes("move") || action.includes("rename")) return `Moved ${name}`;
    if (action.includes("promote")) return "Saved an attachment to the Space";
    return `Edited ${name}`;
  }
  if (key.startsWith("note.")) {
    if (action.includes("search")) return "Searched the Space's notes";
    if (action.includes("read")) return "Read a note";
    if (action.includes("create")) return "Wrote a note";
    if (action.includes("tag")) return "Tagged a note";
    return "Updated a note";
  }
  if (key.startsWith("drawing."))
    return action.includes("read") || action.includes("list")
      ? "Looked at a drawing"
      : "Drew on a drawing";
  if (key.startsWith("message.") || key.startsWith("thread.")) {
    if (action.includes("search")) return "Searched the Space chat";
    if (action.includes("read") || action.includes("list")) return "Read the Space chat";
    return "Posted in the Space chat";
  }
  if (key === "shell.run") return "Ran a command";
  if (key.startsWith("web.")) {
    if (action.includes("search")) return "Searched the web";
    const host = hostOf(step.target);
    return host ? `Read ${host}` : "Read a web page";
  }
  if (key.startsWith("search.")) return "Searched the Space";
  if (key.startsWith("agent."))
    return action.includes("delegate")
      ? "Handed part of the work to another agent"
      : "Worked with another agent";
  if (key.startsWith("app.")) return "Used a connected app";
  if (key.startsWith("integration."))
    return action.includes("search") ? "Looked for a connected app" : "Used a connected app";
  if (key.startsWith("space.")) return "Worked in the Space";
  if (key.startsWith("schedule.")) return "Set up a schedule";
  if (key.startsWith("artifact.")) return "Made an artifact";
  switch (verbOf(step.tool)) {
    case "read":
      if (["webfetch", "web_fetch", "fetch"].includes(key))
        return `Read ${hostOf(step.target) || "a web page"}`;
      if (["ls", "list", "list_dir"].includes(key)) return `Looked through ${file || "a folder"}`;
      return `Read ${file || "a file"}`;
    case "write":
      if (key === "write" || key === "write_file" || key === "create_file")
        return `Wrote ${file || "a file"}`;
      return file ? `Edited ${file}` : "Changed files";
    case "run":
      return codeTools.includes(key) ? "Ran some code" : "Ran a command";
    case "search":
      if (key.includes("web")) return "Searched the web";
      if (key === "glob" || key === "file_search") return "Looked for files";
      if (key === "toolsearch") return "Looked for a tool";
      return "Searched the files";
    case "delegate":
      return "Handed part of the work to a sub-agent";
    case "plan":
      return key === "exitplanmode" ? "Proposed a plan" : "Updated its plan";
    case "ask":
      return "Asked you a question";
    default:
      return "Used a tool";
  }
}

/** The step a run is on now, in the present tense, for a card that says what an agent is doing. */
export function describeLive(
  step: RunStep | undefined,
  options: { folder?: string; page?: string } = {},
): string {
  if (!step) return "Getting started";
  if (step.state !== "running") return "Thinking";
  if (verbOf(step.tool) === "ask") return "Waiting for you";
  const past = describeStep(step, options);
  const present: [RegExp, string][] = [
    [/^Opened /, "Opening "],
    [/^Read /, "Reading "],
    [/^Clicked on /, "Clicking on "],
    [/^Typed into /, "Typing into "],
    [/^Filled in /, "Filling in "],
    [/^Attached /, "Attaching "],
    [/^Edited /, "Editing "],
    [/^Wrote /, "Writing "],
    [/^Created /, "Creating "],
    [/^Deleted /, "Deleting "],
    [/^Ran a command/, "Running a command"],
    [/^Ran some code/, "Running some code"],
    [/^Searched /, "Searching "],
    [/^Looked /, "Looking "],
    [/^Worked /, "Working "],
    [/^Used /, "Using "],
    [/^Posted /, "Posting "],
    [/^Handed /, "Handing "],
    [/^Updated /, "Updating "],
    [/^Checked /, "Checking "],
    [/^Remembered /, "Remembering "],
  ];
  for (const [pattern, replacement] of present) {
    if (pattern.test(past)) return past.replace(pattern, replacement);
  }
  return past;
}

/**
 * A run's steps as sentences, oldest first. A browser step that names no page is on the page the
 * run was last on. A step repeating the one before folds into it, and so does reading the page or
 * file the step before just worked on: that's the agent checking its own work.
 */
export function describeSteps(
  steps: readonly RunStep[],
  options: { folder?: string; includeHidden?: boolean } = {},
): { steps: DescribedStep[]; hiddenCount: number } {
  const described: DescribedStep[] = [];
  let hiddenCount = 0;
  let page = "";
  for (const step of steps) {
    const key = toolKey(step.tool);
    const label = pageLabel(step);
    if (key.startsWith("browser.") && label) page = label;
    const hidden = isHousekeeping(step.tool);
    if (hidden) {
      hiddenCount += 1;
      if (!options.includeHidden) continue;
    }
    const sentence = describeStep(step, { folder: options.folder, page });
    const verb = verbOf(step.tool);
    const place = key.startsWith("browser.") ? page : step.target;
    const failed = step.state === "failed";
    const previous = described[described.length - 1];
    const repeats =
      previous?.sentence === sentence && previous.hidden === hidden && previous.failed === failed;
    const checks =
      verb === "read" &&
      !hidden &&
      !failed &&
      previous !== undefined &&
      !previous.hidden &&
      previous.verb !== "read" &&
      place !== "" &&
      previous.place === place;
    if (previous && (repeats || checks)) {
      previous.seqs.push(step.seq);
      if (step.picture) previous.picture = step.picture;
      previous.running = step.state === "running";
      continue;
    }
    described.push({
      sentence,
      verb,
      seqs: [step.seq],
      at: step.at,
      picture: step.picture,
      failed,
      running: step.state === "running",
      hidden,
      nested: step.nested,
      place,
    });
  }
  return { steps: described, hiddenCount };
}

/** The page a run was last on, for the live line of a browser step that names none. */
export function lastPage(steps: readonly RunStep[]): string {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (toolKey(step.tool).startsWith("browser.")) {
      const label = pageLabel(step);
      if (label) return label;
    }
  }
  return "";
}

/** How far into the run a step began, as "0:42" or "1:02:05". */
export function offsetLabel(at: number, startedAt: number): string {
  const seconds = Math.max(0, Math.round((at - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** How long something took, in a few words. */
export function tookLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${Math.max(seconds, 1)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

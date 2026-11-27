import type { RunStep } from "./activity_api";

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
  seqs: number[];
  at: number;
  picture: string;
  failed: boolean;
  running: boolean;
  hidden: boolean;
  nested: boolean;
  place: string;
  browser: boolean;
  calls: string[];
}

const namespaces = [
  "browser",
  "file",
  "folder",
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
  "artifact",
];

export function toolKey(tool: string): string {
  const bare = (tool.split("__").pop() ?? tool).trim().toLowerCase();
  const underscore = bare.indexOf("_");
  if (!bare.includes(".") && underscore > 0 && namespaces.includes(bare.slice(0, underscore))) {
    return `${bare.slice(0, underscore)}.${bare.slice(underscore + 1)}`;
  }
  return bare;
}

const codeTools = ["js", "javascript", "node", "python", "code_interpreter", "repl"];

const housekeeping = new Set([
  "ask_misty",
  "open_in_code",
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
  "log.work.read",
  "integration.schemas",
  "integration.connected",
  "space.list",
  "space.member.list",
  "space.member.resolve",
  "listmcpresourcestool",
  "readmcpresourcetool",
]);

function isHousekeeping(tool: string): boolean {
  const key = toolKey(tool);
  return housekeeping.has(key) || key.startsWith("browser.downloads");
}

const httpAddress = (text: string) => /^https?:\/\//i.test(text);

function hostOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const shorten = (text: string, most = 60) =>
  text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text;

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
  if (space === "file" || space === "folder") {
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

function describeStep(step: RunStep, options: { folder?: string; page?: string } = {}): string {
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
    if (action === "console") return `Checked the console on ${page}`;
    if (action === "network") return `Checked the requests on ${page}`;
    if (action === "storage") return `Checked the stored data on ${page}`;
    if (action === "verify") return `Checked ${page}`;
    if (action === "highlight") return `Pointed something out on ${page}`;
    if (action === "emulate") return `Changed how ${page} is shown`;
    if (action === "pdf") return `Saved ${page} as a PDF`;
    if (action === "page_tools") return `Used a tool of ${page}`;
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

function foldsInto(previous: DescribedStep | undefined, next: DescribedStep): boolean {
  if (!previous || previous.hidden !== next.hidden) return false;
  if (previous.sentence === next.sentence) return previous.failed === next.failed;
  return (
    !next.hidden &&
    !next.failed &&
    next.verb === "read" &&
    previous.verb !== "read" &&
    next.place !== "" &&
    next.place === previous.place
  );
}

export function describeSteps(
  steps: readonly RunStep[],
  options: { folder?: string; includeHidden?: boolean } = {},
): { steps: DescribedStep[]; hiddenCount: number } {
  let page = "";
  const entries = steps.map((step) => {
    const browser = toolKey(step.tool).startsWith("browser.");
    page = (browser && pageLabel(step)) || page;
    const entry: DescribedStep = {
      sentence: describeStep(step, { folder: options.folder, page }),
      verb: verbOf(step.tool),
      seqs: [step.seq],
      at: step.at,
      picture: step.picture,
      failed: step.state === "failed",
      running: step.state === "running",
      hidden: isHousekeeping(step.tool),
      nested: step.nested,
      place: browser ? page : step.target,
      browser,
      calls: step.callId ? [step.callId] : [],
    };
    return entry;
  });
  const hiddenCount = entries.filter((entry) => entry.hidden).length;
  const shown = options.includeHidden ? entries : entries.filter((entry) => !entry.hidden);
  const folded = shown.reduce<DescribedStep[]>((list, entry) => {
    const previous = list.at(-1);
    if (!previous || !foldsInto(previous, entry)) return [...list, entry];
    previous.seqs.push(...entry.seqs);
    previous.calls.push(...entry.calls);
    previous.picture = entry.picture || previous.picture;
    previous.running = entry.running;
    return list;
  }, []);
  return { steps: folded, hiddenCount };
}

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

export function offsetLabel(at: number, startedAt: number): string {
  const seconds = Math.max(0, Math.round((at - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

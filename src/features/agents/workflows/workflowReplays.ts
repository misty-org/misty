import { localDocuments } from "@/features/misty/localChats";

/**
 * Saved browser replays. A workflow run whose
 * every effect was a browser action is saved with each control named by locator, and the next run of
 * that workflow replays it before calling a model (`browser_replay.rs` in the agent runtime).
 */

const kind = "workflow_replay";
const maxCalls = 100;
const maxCallsBytes = 256 << 10;
const maxStartUrl = 4096;

/** Tools a replayable run may have used: reads, which the replay takes again, and browser actions. */
const replayableTools = new Set([
  "browser.navigate",
  "browser.snapshot",
  "browser.find",
  "browser.wait_for",
  "browser.steps",
  "browser.fill_form",
  "browser.skill",
  "browser.inspect",
  "browser.visual",
  "browser.downloads.list",
]);

type Json = Record<string, unknown>;

/** One completed browser job of a run, in the order they ran. */
export interface BrowserJob {
  operation: string;
  input: Json;
  output: Json;
}

interface ReplayCall {
  tool: string;
  args: Json;
}

interface StoredReplay {
  method_version_id: string;
  start_url: string;
  calls: ReplayCall[];
  source_run_id: string;
  recorded_at: string;
}

function mentionsRef(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(mentionsRef);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => key === "ref" || mentionsRef(item));
}

/** The steps that ran, each ref replaced by its locator. Null when one has no locator recorded. */
function replaySteps(job: BrowserJob): Json[] | null {
  const requested: Json[] = [];
  if (job.operation === "browser.steps") {
    for (const step of (job.input.steps as Json[] | undefined) ?? []) requested.push(step);
  } else {
    for (const field of (job.input.fields as Json[] | undefined) ?? []) {
      const step: Json = { ref: field.ref };
      const value = field.value;
      if (typeof value === "string") Object.assign(step, { action: "fill", text: value });
      else if (typeof value === "number")
        Object.assign(step, { action: "fill", text: String(value) });
      else if (typeof value === "boolean") step.action = value ? "check" : "uncheck";
      else if (Array.isArray(value)) Object.assign(step, { action: "select", values: value });
      else return null;
      requested.push(step);
    }
  }
  const out: Json[] = [];
  for (const record of (job.output.steps as Json[] | undefined) ?? []) {
    const index = Number(record.index);
    if (record.ok !== true || !(index >= 1) || index > requested.length) continue;
    const step: Json = { ...requested[index - 1] };
    if ("ref" in step) {
      if (!record.locator || typeof record.locator !== "object") return null;
      delete step.ref;
      step.locator = record.locator;
    }
    out.push(step);
  }
  return out;
}

/**
 * Turns a successful run's browser jobs into replay calls. Null when any effect can't be reproduced
 * exactly: another tool's effect, a screen goal, a file upload, data the model extracted, or a control
 * without a recorded locator.
 */
export function buildBrowserReplay(
  toolNames: string[],
  jobs: BrowserJob[],
): { startUrl: string; calls: ReplayCall[] } | null {
  if (toolNames.some((name) => !replayableTools.has(name))) return null;
  let startUrl = "";
  const calls: ReplayCall[] = [];
  for (const job of jobs) {
    switch (job.operation) {
      case "browser.snapshot":
      case "browser.find":
      case "browser.inspect":
      case "browser.visual":
      case "browser.downloads.list":
        if (!startUrl && !calls.length && typeof job.output.url === "string")
          startUrl = job.output.url;
        break;
      case "browser.navigate": {
        const url = job.input.url;
        if (typeof url !== "string" || !url) return null;
        calls.push({ tool: "browser.navigate", args: { url } });
        break;
      }
      case "browser.wait_for": {
        const args: Json = {};
        for (const key of ["text", "textGone", "urlIncludes", "timeoutMs"])
          if (key in job.input) args[key] = job.input[key];
        calls.push({ tool: "browser.wait_for", args });
        break;
      }
      case "browser.steps":
      case "browser.fill_form": {
        const steps = replaySteps(job);
        if (!steps) return null;
        if (steps.length)
          calls.push({
            tool: "browser.steps",
            args: {
              steps,
              ...(job.input.allowConsequential === true ? { allowConsequential: true } : {}),
            },
          });
        break;
      }
      case "browser.skill":
        if (job.output.ok !== true || mentionsRef(job.input.args)) return null;
        calls.push({
          tool: "browser.skill",
          args: {
            skill: job.input.skill,
            action: job.input.action,
            args: job.input.args,
            ...(job.input.allowConsequential === true ? { allowConsequential: true } : {}),
          },
        });
        break;
      default:
        return null;
    }
    if (calls.length > maxCalls) return null;
  }
  return calls.length ? { startUrl, calls } : null;
}

async function storedReplay(account: string, versionId: string): Promise<StoredReplay | null> {
  const raw = await localDocuments.get(account, kind, versionId);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredReplay;
  } catch {
    return null;
  }
}

/**
 * Call when a workflow run ends well. Saves it for replay, or forgets an older replay when this run
 * can't be replayed. Never changes the run's own result, so it doesn't throw.
 */
export async function recordWorkflowReplay(
  account: string,
  run: { methodVersionId: string; runId: string; toolNames: string[]; jobs: BrowserJob[] },
): Promise<void> {
  try {
    const built = buildBrowserReplay(run.toolNames, run.jobs);
    const document = built
      ? JSON.stringify({
          method_version_id: run.methodVersionId,
          start_url: built.startUrl,
          calls: built.calls,
          source_run_id: run.runId,
          recorded_at: new Date().toISOString(),
        } satisfies StoredReplay)
      : null;
    if (
      !document ||
      built!.startUrl.length > maxStartUrl ||
      JSON.stringify(built!.calls).length > maxCallsBytes
    ) {
      // The saved steps no longer describe this workflow's last good run.
      await localDocuments.remove(account, kind, run.methodVersionId);
      return;
    }
    const raw = await localDocuments.get(account, kind, run.methodVersionId);
    await localDocuments.swap(account, kind, run.methodVersionId, raw, document);
  } catch {
    // A replay only saves model calls.
  }
}

/**
 * The `browser_replay` a workflow run's context carries, when it has a saved replay and a browser that
 * can act by ref. Null otherwise.
 */
export async function browserReplayForRun(
  account: string,
  methodVersionId: string | undefined,
  contexts: { kind: string; opaqueRef: string; capabilities: string[] }[],
): Promise<{
  scope_id: string;
  start_url: string;
  calls: ReplayCall[];
  recorded_at: string;
} | null> {
  if (!methodVersionId?.trim()) return null;
  const replay = await storedReplay(account, methodVersionId).catch(() => null);
  if (!replay) return null;
  const browser = contexts.find(
    (context) =>
      context.kind === "browser_tab" &&
      context.capabilities.includes("browser.steps") &&
      context.capabilities.includes("browser.snapshot"),
  );
  return browser
    ? {
        scope_id: browser.opaqueRef,
        start_url: replay.start_url,
        calls: replay.calls,
        recorded_at: replay.recorded_at,
      }
    : null;
}

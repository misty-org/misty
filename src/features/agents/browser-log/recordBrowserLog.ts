import { invoke } from "@tauri-apps/api/core";
import { agentTab } from "../tabs/agentTabs";
import type { ClaimedWorkflowNodeJob } from "../runs/jobs/workerBrowserJobs";
import { browserLogApi, type BrowserLogEntryIn } from "./browserLogApi";

/**
 * Files each browser action of a run in its browser log, after it ran: one row per action, so a
 * batch of steps is as many rows, each with the element it acted on and what it did to the page.
 * The page is pictured after the job, at most once a PICTURE_EVERY_MS per tab. Typed text never
 * goes in: only the element it went into.
 */

type Job = ClaimedWorkflowNodeJob["job"];

/** Fired when a run's browser log has a new row, so an open log reads it again. */
export const BROWSER_LOG_EVENT = "misty:browser-log";

const PICTURE_EVERY_MS = 600;
const PICTURE_WIDTH = 800;
const pictured = new Map<string, number>();

/** Operations that open, close or list tabs rather than act in one. */
const housekeeping = new Set(["browser.session", "browser.downloads.list"]);

const text = (value: unknown) => (typeof value === "string" ? value : "");

const verdictOf = (effect: unknown): BrowserLogEntryIn["verdict"] => {
  if (effect === "navigated") return "navigated";
  if (effect === "page changed") return "changed";
  if (effect === "no change") return "unchanged";
  return "";
};

function pageOf(output: Record<string, unknown>) {
  const page = (output.page ?? output.snapshot ?? output) as { url?: unknown; title?: unknown };
  return { url: text(page.url) || text(output.url), title: text(page.title) };
}

/** What a single operation acted on, from its input. */
function targetOf(operation: string, input: Record<string, unknown>): string {
  switch (operation) {
    case "browser.navigate":
      return text(input.url);
    case "browser.find":
      return text(input.query);
    case "browser.extract":
      return text(input.instruction).slice(0, 160);
    case "browser.wait_for":
      return text(input.text) || text(input.textGone) || text(input.urlIncludes);
    case "browser.act":
      return text(input.goal).slice(0, 160);
    case "browser.skill":
      return [text(input.skill), text(input.action)].filter(Boolean).join(".");
    default:
      return "";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

/** The rows one job makes: one per step of a batch, else one. */
export function entriesOf(
  job: Job,
  outcome: { output: Record<string, unknown> } | { error: unknown },
  durationMs: number,
): Omit<BrowserLogEntryIn, "picture">[] {
  const input = (job.input ?? {}) as Record<string, unknown>;
  const base = {
    runId: job.runId,
    callId: job.callId ?? job.nodeId,
    scopeId: job.scopeId,
    note: "",
    durationMs,
  };
  if ("error" in outcome) {
    return [
      {
        ...base,
        operation: job.operation,
        target: targetOf(job.operation, input),
        url: text(agentTab(job.scopeId)?.url),
        title: text(agentTab(job.scopeId)?.title),
        verdict: "",
        state: "failed",
        error: errorText(outcome.error),
      },
    ];
  }
  const output = outcome.output;
  const { url, title } = pageOf(output);
  const steps = Array.isArray(output.steps) ? (output.steps as Record<string, unknown>[]) : null;
  if (steps?.length) {
    const each = Math.round(durationMs / steps.length);
    const rows = steps.map((step) => ({
      ...base,
      durationMs: each,
      operation: `browser.${text(step.action) || "step"}`,
      target: text(step.target) || (text(step.ref) ? `element ${text(step.ref)}` : ""),
      url,
      title,
      verdict: verdictOf(step.effect),
      state: step.ok === true ? ("completed" as const) : ("failed" as const),
      error: text(step.error),
      note: [
        text(step.note),
        step.opensNewTab === true ? "opened a new tab" : "",
        step.atEnd === true ? "reached the end" : "",
      ]
        .filter(Boolean)
        .join(", "),
    }));
    const stopped = text(output.stopped);
    if (stopped && rows.length) rows[rows.length - 1]!.note = stopped;
    return rows;
  }
  const failed = output.ok === false || output.status === "failure";
  return [
    {
      ...base,
      operation: job.operation,
      target: targetOf(job.operation, input),
      url,
      title,
      verdict: job.operation === "browser.navigate" && !failed ? "navigated" : "",
      state: failed ? "failed" : "completed",
      error: failed
        ? text(output.error) || text((output.tool_error as { message?: unknown })?.message)
        : "",
    },
  ];
}

async function pictureOf(scopeId: string): Promise<string | undefined> {
  const viewId = agentTab(scopeId)?.viewId;
  if (!viewId) return undefined;
  if (Date.now() - (pictured.get(scopeId) ?? 0) < PICTURE_EVERY_MS) return undefined;
  pictured.set(scopeId, Date.now());
  const picture = await invoke<{ dataUrl?: string }>("browser_webview_picture", {
    request: { id: viewId, width: PICTURE_WIDTH },
  }).catch(() => undefined);
  return picture?.dataUrl?.startsWith("data:image/jpeg;") ? picture.dataUrl : undefined;
}

/** Logs a job's actions; never throws, and never holds the job up. */
export function recordBrowserLog(
  job: Job,
  outcome: { output: Record<string, unknown> } | { error: unknown },
  durationMs: number,
) {
  if (housekeeping.has(job.operation) || job.operation.startsWith("browser.workspace.")) return;
  const rows = entriesOf(job, outcome, durationMs);
  void (async () => {
    const picture = await pictureOf(job.scopeId);
    for (const [index, row] of rows.entries()) {
      const last = index === rows.length - 1;
      await browserLogApi
        .record(last && picture ? { ...row, picture } : row)
        .catch(() => undefined);
    }
    window.dispatchEvent(new CustomEvent(BROWSER_LOG_EVENT, { detail: { runId: job.runId } }));
  })();
}

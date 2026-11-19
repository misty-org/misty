import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * A run's browser log on this computer (`run_control/browser_log.rs`): every action the agent took
 * in its tabs, with the page it was on, what the action did and a picture after it. It names pages
 * and elements, so it stays here: nothing of it reaches the server, and typed text is never kept.
 */

/** One browser action, as the window reports it after it ran. */
export interface BrowserLogEntryIn {
  runId: string;
  /** The tool call the action was part of. */
  callId: string;
  scopeId: string;
  /** The browser operation, such as `browser.click`. */
  operation: string;
  /** What it acted on: an element's role and name, or the address it opened. */
  target: string;
  url: string;
  title: string;
  /** What the action did to the page, when it said. */
  verdict: "" | "navigated" | "changed" | "unchanged";
  state: "completed" | "failed";
  error: string;
  note: string;
  durationMs: number;
  /** The page after the action, as a JPEG data address. */
  picture?: string;
}

/** One action as the log keeps it. */
export interface BrowserLogRow {
  seq: number;
  at: number;
  /** The tool call it was part of, keyed as the activity log keys its steps (`<run>:<call>`). */
  callId: string;
  scopeId: string;
  operation: string;
  target: string;
  url: string;
  title: string;
  verdict: BrowserLogEntryIn["verdict"];
  state: "completed" | "failed";
  error: string;
  note: string;
  durationMs: number;
  /** Taken by a sub-agent of the run. */
  nested: boolean;
  picture: string;
}

const call = <T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> =>
  hasTauriInternals() ? invoke<T>(command, args) : Promise.resolve(fallback);

export const browserLogApi = {
  record: (entry: BrowserLogEntryIn) =>
    call<void>("agent_browser_log_record", { entry }, undefined),
  rows: (runId: string) => call<BrowserLogRow[]>("agent_browser_log", { runId }, []),
  picture: (runId: string, picture: string) =>
    call<string>("agent_browser_log_picture", { runId, picture }, ""),
};

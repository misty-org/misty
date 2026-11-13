import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * A run's activity on this computer (`run_control/run_steps.rs` and `run_ledger.rs`). Steps name
 * files and pages, so they stay here: nothing of this reaches the server.
 */

/** One tool call of a run, as native code recorded it: no arguments, no result. */
export interface RunStep {
  seq: number;
  at: number;
  tool: string;
  /** The file or address the call worked on, if it named one. */
  target: string;
  /** The page's title, for a call that ended on a web page. */
  title: string;
  state: "running" | "completed" | "failed";
  durationMs: number;
  /** Made by a sub-agent of the run. */
  nested: boolean;
  /** The picture of the page after the step, if one was taken. */
  picture: string;
}

/** One run in a Space's timeline. */
export interface RunRow {
  runId: string;
  conversationId: string;
  engine: string;
  mode: string;
  state: "running" | "needs-you" | "completed" | "failed" | "canceled";
  startedAt: number;
  updatedAt: number;
  tools: number;
  files: string[];
}

const call = <T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> =>
  hasTauriInternals() ? invoke<T>(command, args) : Promise.resolve(fallback);

export const activityApi = {
  steps: (runId: string) => call<RunStep[]>("agent_run_steps", { runId }, []),
  latestSteps: (runIds: string[]) =>
    call<{ runId: string; step: RunStep }[]>("agent_run_latest_steps", { runIds }, []),
  timeline: (conversationIds: string[], limit = 200) =>
    call<RunRow[]>("agent_run_timeline", { conversationIds, limit }, []),
  picture: (runId: string, picture: string) =>
    call<string>("agent_run_step_picture", { runId, picture }, ""),
  clear: () => call<void>("agent_run_steps_clear", {}, undefined),
};

import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface RunStep {
  seq: number;
  at: number;
  tool: string;
  target: string;
  title: string;
  state: "running" | "completed" | "failed";
  durationMs: number;
  nested: boolean;
  picture: string;
  callId?: string;
}

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

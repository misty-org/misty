import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface BrowserLogEntryIn {
  runId: string;
  callId: string;
  scopeId: string;
  operation: string;
  target: string;
  url: string;
  title: string;
  verdict: "" | "navigated" | "changed" | "unchanged";
  state: "completed" | "failed";
  error: string;
  note: string;
  durationMs: number;
  picture?: string;
}

export interface BrowserLogRow {
  seq: number;
  at: number;
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

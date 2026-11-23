// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export type CliRemoveKind = "misty" | "npm" | "brew" | "maker";

export interface CliVersionStatus {
  engine: string;
  installed: boolean;
  localVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateKind: "npm" | "native" | null;
  removeKind?: CliRemoveKind | null;
}

export interface CliUpdatePlan {
  engine: string;
  action: "install" | "update";
  kind: "npm" | "native" | "none";
  steps: string[];
  needsHelper: boolean;
  needsDeveloperTools: boolean;
  canRun: boolean;
  blockers: string[];
  platform: string;
}

interface CliUpdateResult {
  ok: boolean;
  version: string | null;
}

export interface CliSignInStatus {
  engine: string;
  installed: boolean;
  signedIn: boolean | null;
  detail: string | null;
}

interface CliUpdateProgressEvent {
  runId: string;
  engine: string;
  phase: "started" | "stdout" | "stderr" | "finished" | "step";
  line: string | null;
  exitOk: boolean | null;
}

const CLI_UPDATE_PROGRESS_EVENT = "engine-cli://update-progress";

export const cliApi = {
  status: (engine: string) => invoke<CliVersionStatus>("engine_cli_status", { engine }),
  updatePlan: (engine: string) => invoke<CliUpdatePlan>("engine_cli_update_plan", { engine }),
  update: (engine: string, runId: string) =>
    invoke<CliUpdateResult>("engine_cli_update", { engine, runId }),
  signedIn: (engine: string) => invoke<CliSignInStatus>("engine_cli_signed_in", { engine }),
  remove: (engine: string) => invoke<void>("engine_cli_remove", { engine }),
};

export function listenCliUpdateProgress(
  onEvents: (events: CliUpdateProgressEvent[]) => void,
): Promise<UnlistenFn> {
  if (!hasTauriInternals()) return Promise.resolve(() => {});
  return listen<CliUpdateProgressEvent[] | CliUpdateProgressEvent>(
    CLI_UPDATE_PROGRESS_EVENT,
    (event) => onEvents(Array.isArray(event.payload) ? event.payload : [event.payload]),
  );
}

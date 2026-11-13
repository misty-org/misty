// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface CliVersionStatus {
  engine: string;
  installed: boolean;
  localVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  /** How install and update run, always inside the app: "npm", or "native" for the maker's own
   *  build or installer; null when Misty can't install it. */
  updateKind: "npm" | "native" | null;
  /** The copy found is the one Misty installed in `~/.misty/engines`, so it can be removed. */
  installedByMisty?: boolean;
}

export interface CliUpdatePlan {
  engine: string;
  action: "install" | "update";
  kind: "npm" | "native" | "none";
  /** What runs or is downloaded, one line per step, for Show details. */
  steps: string[];
  /** Node.js is fetched into Misty's folder first. */
  needsHelper: boolean;
  /** Apple's developer tools are installed first: running the plan opens their installer. */
  needsDeveloperTools: boolean;
  canRun: boolean;
  blockers: string[];
  platform: string;
}

interface CliUpdateResult {
  ok: boolean;
  version: string | null;
}

/** Whether the person is signed in to the CLI, as the CLI itself says. null when it can't say. */
export interface CliSignInStatus {
  engine: string;
  installed: boolean;
  signedIn: boolean | null;
  detail: string | null;
}

interface CliUpdateProgressEvent {
  runId: string;
  engine: string;
  /** "step" names what the run does now in `line`: "helper" (Node.js) or "engine". */
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

/** Streams install output; each event is a batch of lines. */
export function listenCliUpdateProgress(
  onEvents: (events: CliUpdateProgressEvent[]) => void,
): Promise<UnlistenFn> {
  if (!hasTauriInternals()) return Promise.resolve(() => {});
  return listen<CliUpdateProgressEvent[] | CliUpdateProgressEvent>(
    CLI_UPDATE_PROGRESS_EVENT,
    (event) => onEvents(Array.isArray(event.payload) ? event.payload : [event.payload]),
  );
}

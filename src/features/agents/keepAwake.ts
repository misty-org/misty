import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * While an agent works on this computer it stays awake, unless the account
 * turned that off in Settings › Agents › Screens
 * (docs/sync/devices.md). Each kind of work holds a reason;
 * the computer is held while any reason remains.
 */
const reasons = new Set<string>();
let enabled: boolean | undefined;
let loading: Promise<void> | undefined;
let held = false;
let applying: Promise<void> = Promise.resolve();

function loadSetting(): Promise<void> {
  loading ??= import("@/features/ai-surface/api")
    .then(({ aiSurfaceApi }) => aiSurfaceApi.settings())
    .then((result) => {
      enabled ??= result.settings.keep_awake_for_agents ?? true;
    })
    // The setting is on by default; a failed read keeps the default.
    .catch(() => {
      enabled ??= true;
    });
  return loading;
}

function apply(): Promise<void> {
  applying = applying.then(async () => {
    if (!hasTauriInternals()) return;
    if (enabled === undefined) await loadSetting();
    const want = enabled !== false && reasons.size > 0;
    if (want === held) return;
    try {
      await invoke("power_keep_awake", { hold: want });
      held = want;
    } catch {
      // Sleep stays the system's to decide; work goes on regardless.
    }
  });
  return applying;
}

export function holdAwake(reason: string): Promise<void> {
  reasons.add(reason);
  return apply();
}

export function releaseAwake(reason: string): Promise<void> {
  reasons.delete(reason);
  return apply();
}

/** Applies a change made in Settings at once. */
export function setKeepAwakeForAgents(value: boolean): Promise<void> {
  enabled = value;
  return apply();
}

/** Holds the computer awake while this device's own agent task runs. */
export function watchLocalExecutionForKeepAwake(
  subscribe: (listener: (running: boolean) => void) => () => void,
): () => void {
  return subscribe((running) => void (running ? holdAwake("local") : releaseAwake("local")));
}

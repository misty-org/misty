import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { aiSurfaceApi } from "../invocations/api";

const reasons = new Set<string>();
let enabled: boolean | undefined;
let loading: Promise<void> | undefined;
let held = false;
let applying: Promise<void> = Promise.resolve();

function loadSetting(): Promise<void> {
  loading ??= aiSurfaceApi
    .settings()
    .then((result) => {
      enabled ??= result.settings.keep_awake_for_agents ?? true;
    })
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
    } catch {}
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

export function setKeepAwakeForAgents(value: boolean): Promise<void> {
  enabled = value;
  return apply();
}

export function watchLocalExecutionForKeepAwake(
  subscribe: (listener: (running: boolean) => void) => () => void,
): () => void {
  return subscribe((running) => void (running ? holdAwake("local") : releaseAwake("local")));
}

import { invoke } from "@tauri-apps/api/core";
import { keepLiveRuntimeIds, runtimeQueues } from "@/features/app-windows";

export async function closeOrphanAgentPages(): Promise<void> {
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  await invoke<void>("browser_webviews_close_except", {
    request: { keep: [...keepLiveRuntimeIds], agentPages: true },
  }).catch(() => undefined);
}

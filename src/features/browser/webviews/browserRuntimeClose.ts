import { invoke } from "@tauri-apps/api/core";
import { keepLiveRuntimeIds, runtimeQueues } from "@/features/app-windows";

/**
 * Closes the agents' pages left from before this renderer loaded. The agent browser brings its
 * tabs back asleep and opens a new page when one is shown, so an old page has no tab: it would
 * never move or close again and would stay drawn over the window. Pages opened since the load are
 * kept (`keepLiveRuntimeIds`).
 */
export async function closeOrphanAgentPages(): Promise<void> {
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  await invoke<void>("browser_webviews_close_except", {
    request: { keep: [...keepLiveRuntimeIds], agentPages: true },
  }).catch(() => undefined);
}

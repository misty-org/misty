import { invoke } from "@tauri-apps/api/core";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import { decodeTabHistory, encodeTabHistory } from "@/features/webviews/tabHistory";
import { liveBrowserViews, viewUrl } from "./tabs";

const SAVE_DELAY_MS = 2000;
/** Last encoding saved (or loaded) per tab, so unchanged histories aren't rewritten. */
const saved = new Map<string, string | null>();

/** Loads saved histories into tabs that have none yet: after a switch, and
 * at startup, so back/forward reaches pages from before. */
export async function hydrateViewHistories(stillCurrent: () => boolean): Promise<void> {
  for (const tab of liveBrowserViews()) {
    if (!stillCurrent()) return;
    const current = useBrowserRuntimeStore.getState().histories[tab.id];
    if (current && current.entries.length > 1) continue;
    const raw = await invoke<string | null>("browser_view_history_load", { viewId: tab.id }).catch(
      () => null,
    );
    if (!raw || !stillCurrent()) continue;
    const history = decodeTabHistory(raw, viewUrl(tab));
    if (!history) continue;
    useBrowserRuntimeStore.getState().replaceHistory(tab.id, history);
    saved.set(tab.id, encodeTabHistory(history));
  }
}

/** Saves each tab's history to its synced slot shortly after it changes,
 * while this device drives the workspace. */
export function startViewHistorySync(driving: () => boolean): () => void {
  let timer: number | undefined;
  const flush = () => {
    timer = undefined;
    if (!driving()) return;
    const histories = useBrowserRuntimeStore.getState().histories;
    for (const tab of liveBrowserViews()) {
      const history = histories[tab.id];
      if (!history) continue;
      const encoded = encodeTabHistory(history);
      if (saved.get(tab.id) === encoded) continue;
      saved.set(tab.id, encoded);
      void invoke("browser_view_history_save", { viewId: tab.id, history: encoded }).catch(() =>
        saved.delete(tab.id),
      );
    }
  };
  const unsubscribe = useBrowserRuntimeStore.subscribe((state, previous) => {
    if (state.histories === previous.histories) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, SAVE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    window.clearTimeout(timer);
  };
}

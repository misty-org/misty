import { listen } from "@tauri-apps/api/event";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import { restorePageState } from "./native";
import { pageRestoreSettings } from "./settings";
import { liveBrowserViews, pageReady, runtimeOf } from "./tabs";

const LOAD_WAIT_MS = 30_000;
const SETTLE_MS = 800;

/** Tabs WebKit reloaded that have not been restored yet. Capture skips them,
 * so the fresh page cannot overwrite the state it is about to get back. */
const reloading = new Set<string>();
export const awaitingRestore = (tabId: string) => reloading.has(tabId);

const findTab = (tabId: string) => liveBrowserViews().find((tab) => tab.id === tabId);
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * WebKit can end a page's process while Misty is in the background (memory
 * pressure, a long sleep), and the page then loads again from the top. Put
 * it back where it was from the page state saved a few seconds earlier: the
 * scroll position and what was typed. No agent pass runs here.
 */
export function startRestoreAfterReload(driving: () => boolean): () => void {
  let stopped = false;
  const unlisten = listen<{ id: string | null }>(
    "misty://browser-page-process-ended",
    ({ payload }) => {
      if (!payload.id || !driving() || !pageRestoreSettings().enabled) return;
      const tab = liveBrowserViews().find((view) => runtimeOf(view) === payload.id);
      if (tab) void restoreWhenLoaded(tab.id, () => !stopped && driving());
    },
  );
  return () => {
    stopped = true;
    void unlisten.then((stop) => stop());
  };
}

async function restoreWhenLoaded(tabId: string, stillCurrent: () => boolean): Promise<void> {
  if (reloading.has(tabId)) return;
  reloading.add(tabId);
  try {
    // The reload starts a moment after the event; wait for it to finish.
    const started = Date.now();
    let sawLoading = false;
    for (;;) {
      await wait(250);
      const tab = findTab(tabId);
      if (!tab || !stillCurrent() || Date.now() - started > LOAD_WAIT_MS) return;
      if (useBrowserRuntimeStore.getState().loading[tabId]) sawLoading = true;
      else if ((sawLoading || Date.now() - started > 3000) && pageReady(tab)) break;
    }
    await wait(SETTLE_MS);
    const tab = findTab(tabId);
    if (!tab || !stillCurrent()) return;
    await restorePageState(runtimeOf(tab), tabId).catch(() => undefined);
  } finally {
    reloading.delete(tabId);
  }
}

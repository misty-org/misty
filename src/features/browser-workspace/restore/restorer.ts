import { agentRestore } from "./agentRestore";
import { reserveAgentRestore } from "./budget";
import { restorePageState } from "./native";
import { pageRestoreSettings } from "./settings";
import { usePageRestoreStore, type TabRestore } from "./store";
import { liveBrowserTabs, pageReady, runtimeOf } from "./tabs";

const SETTLE_MS = 800;
const WATCH_MS = 10 * 60_000;

/**
 * After this device takes over a workspace, bring each tab back to the state
 * the previous device left it in. Visible tabs are created (and restored)
 * first; background tabs restore when their page first loads.
 */
export function restoreAfterSwitch(stillCurrent: () => boolean, only?: string[]): () => void {
  if (!pageRestoreSettings().enabled) return () => undefined;
  const store = usePageRestoreStore.getState();
  if (!only) store.clear();
  const pending = new Set(
    liveBrowserTabs()
      .map((tab) => tab.id)
      .filter((id) => !only || only.includes(id)),
  );
  const busy = new Set<string>();
  let agentTabs = 0;
  let stopped = false;
  const started = Date.now();

  const restoreTab = async (tabId: string) => {
    const tab = liveBrowserTabs().find((candidate) => candidate.id === tabId);
    if (!tab) return;
    const base: Omit<TabRestore, "status"> = {
      tabId,
      title: tab.title,
      remaining: 0,
      secrets: 0,
      agentUsed: false,
    };
    store.set({ ...base, status: "restoring" });
    const runtime = runtimeOf(tab);
    try {
      let report = await restorePageState(runtime, tabId);
      if (report.status === "none") {
        usePageRestoreStore.setState((state) => {
          const tabs = { ...state.tabs };
          delete tabs[tabId];
          return { tabs };
        });
        return;
      }
      let agentUsed = false;
      if (
        report.status === "partial" &&
        report.agent_fields.length > 0 &&
        pageRestoreSettings().agent &&
        reserveAgentRestore(agentTabs)
      ) {
        agentTabs++;
        agentUsed = true;
        const outcome = await agentRestore(runtime, report, () => !stopped && stillCurrent());
        // Re-apply to fill fields the agent revealed and measure what remains.
        if (outcome !== "user") report = await restorePageState(runtime, tabId);
      }
      const remaining = report.agent_fields.length + report.withheld;
      store.set({
        ...base,
        agentUsed,
        secrets: report.secrets,
        remaining,
        status: remaining === 0 ? "restored" : "partial",
      });
    } catch {
      store.set({ ...base, status: "failed" });
    }
  };

  const timer = window.setInterval(() => {
    if (stopped || !stillCurrent() || Date.now() - started > WATCH_MS || pending.size === 0) {
      window.clearInterval(timer);
      return;
    }
    for (const tab of liveBrowserTabs()) {
      if (!pending.has(tab.id) || busy.has(tab.id) || !pageReady(tab)) continue;
      pending.delete(tab.id);
      busy.add(tab.id);
      window.setTimeout(() => {
        if (stopped || !stillCurrent()) return;
        void restoreTab(tab.id).finally(() => busy.delete(tab.id));
      }, SETTLE_MS);
    }
  }, 1000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

/** Manual retry for a partially restored tab ("Finish restoring"). It uses
 * the same per-switch and daily agent budget. */
export function finishRestoring(tabId: string): () => void {
  return restoreAfterSwitch(() => true, [tabId]);
}

import { invoke } from "@tauri-apps/api/core";
import { browserHomeUrl } from "@/features/app-windows";
import { setBrowserRuntimeKeepLive } from "@/features/app-windows";
import {
  addBrowserTab,
  browserTabActed,
  finishTaskViews,
  removeBrowserTab,
  updateBrowserTab,
  viewOfTab,
  type AgentBrowserTab,
} from "../agent-browser/agent_browser_store";
import { followAgentPages } from "../agent-browser/agent_page_events";
import { pictureAgentTab } from "./agent_tab_pictures";
import { livePagesAllowed, pressureLevel, resetMemoryPressure } from "./agent_tab_pressure";
import { agentPageBounds, restoredAgentTabs, type AgentTab } from "./agent_tab_records";

export { agentPageBounds };

const CHECK_MS = 5_000;
const KEEP_ASLEEP = 500;

const tabs = restoredAgentTabs();

const pending = new Map<string, Promise<unknown>>();
let timer: ReturnType<typeof setInterval> | undefined;
let shownScope: string | undefined;
const kept = new Set<string>();

export function keepAgentTab(scopeId: string) {
  if (tabs.has(scopeId)) kept.add(scopeId);
}

const serial = <T>(scopeId: string, work: () => Promise<T>): Promise<T> => {
  const next = (pending.get(scopeId) ?? Promise.resolve()).then(work, work);
  pending.set(
    scopeId,
    next.catch(() => undefined),
  );
  return next;
};

export function trackAgentTab(
  tab: Pick<AgentTab, "scopeId" | "viewId" | "taskId" | "runId"> & {
    url?: string;
    conversationId?: string;
    view?: { id: string; label: string };
  },
) {
  const { conversationId, view, ...record } = tab;
  tabs.set(tab.scopeId, { url: "", title: "", ...record, lastUsed: Date.now(), busy: 0 });
  setBrowserRuntimeKeepLive(tab.viewId, true);
  if (conversationId)
    addBrowserTab(
      conversationId,
      { ...(view ?? { id: tab.taskId, label: "Main" }), taskId: tab.taskId },
      {
        scopeId: tab.scopeId,
        url: tab.url ?? "",
        title: "",
        viewId: tab.viewId,
      },
    );
  timer ??= setInterval(() => void sleepIdleAgentTabs(), CHECK_MS);
  followAgentPages(noteAgentPage);
}

export function rememberAgentTab(tab: AgentTab) {
  tabs.set(tab.scopeId, tab);
}

export function noteAgentPage(
  viewId: string,
  change: Partial<Pick<AgentBrowserTab, "url" | "title" | "loading" | "faviconUrl">>,
) {
  const tab = agentTabOfView(viewId);
  if (!tab) return;
  const reported = Object.fromEntries(
    Object.entries(change).filter(([, value]) => value !== undefined),
  );
  if (reported.url) tab.url = String(reported.url);
  if (reported.title) tab.title = String(reported.title);
  updateBrowserTab(tab.scopeId, reported);
  if (change.loading === false) void pictureAgentTab(tab.scopeId);
}

export function setShownAgentTab(scopeId: string | undefined) {
  shownScope = scopeId;
  const tab = scopeId ? tabs.get(scopeId) : undefined;
  if (tab) tab.lastUsed = Date.now();
}

export const agentTab = (scopeId: string) => tabs.get(scopeId);
const agentTabOfView = (viewId: string) =>
  viewId ? [...tabs.values()].find((tab) => tab.viewId === viewId) : undefined;
export const agentTabsForTask = (taskId: string) =>
  [...tabs.values()].filter((tab) => tab.taskId === taskId);

export function noteAgentTabJob(scopeId: string, runId: string, busy: boolean) {
  const tab = tabs.get(scopeId);
  if (!tab) return;
  tab.lastUsed = Date.now();
  tab.runId = runId || tab.runId;
  tab.busy = Math.max(0, tab.busy + (busy ? 1 : -1));
  if (busy) browserTabActed(scopeId);
}

export function sleepAgentTab(scopeId: string, force = false): Promise<void> {
  return serial(scopeId, async () => {
    const tab = tabs.get(scopeId);
    if (!tab?.viewId || (!force && (tab.busy || scopeId === shownScope))) return;
    const view = tab.viewId;
    tab.viewId = "";
    setBrowserRuntimeKeepLive(view, false);
    const where = await invoke<{ url?: string; title?: string }>("browser_webview_sleep", {
      request: { id: view },
    }).catch(() => ({}) as { url?: string; title?: string });
    if (where.url && /^https?:/.test(where.url)) tab.url = where.url;
    if (where.title) tab.title = where.title;
    updateBrowserTab(scopeId, { viewId: "", loading: false, url: tab.url, title: tab.title });
  });
}

export function wakeAgentTab(scopeId: string): Promise<boolean> {
  return serial(scopeId, async () => {
    const tab = tabs.get(scopeId);
    if (!tab) return false;
    if (tab.viewId) return true;
    await makeRoom(scopeId);
    const id = `agent-${crypto.randomUUID()}`;
    const finished = viewOfTab(scopeId)?.view.status === "done";
    try {
      await invoke("browser_webview_create", {
        request: {
          id,
          scopeId,
          url: tab.url || browserHomeUrl(),
          originSpaceId: "",
          agentRunId: finished ? undefined : tab.runId,
          ...agentPageBounds(),
        },
      });
      if (!finished) await invoke("agent_workspace_bind_scope", { taskId: tab.taskId, scopeId });
      await invoke("browser_webview_hide", { request: { id, keepLive: true } });
    } catch {
      await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
      return false;
    }
    tab.viewId = id;
    tab.lastUsed = Date.now();
    setBrowserRuntimeKeepLive(id, true);
    updateBrowserTab(scopeId, { viewId: id });
    return true;
  });
}

async function makeRoom(waking: string) {
  const budget = await livePagesAllowed();
  const live = [...tabs.values()].filter((tab) => tab.viewId && tab.scopeId !== waking);
  if (live.length < budget) return;
  const spare = live
    .filter((tab) => !tab.busy && tab.scopeId !== shownScope)
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, live.length - budget + 1);
  await Promise.allSettled(spare.map((tab) => sleepAgentTab(tab.scopeId)));
}

export async function sleepIdleAgentTabs() {
  if ((await pressureLevel()) !== "normal") {
    await Promise.allSettled(
      [...tabs.values()]
        .filter((tab) => tab.viewId && !tab.busy)
        .map((tab) => sleepAgentTab(tab.scopeId)),
    );
  }
}

const AWAKE_AT_END = 8;

export async function sleepTaskTabs(taskId: string) {
  finishTaskViews(taskId);
  const mine = agentTabsForTask(taskId);
  const recent = new Set(
    [...mine]
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, AWAKE_AT_END)
      .map((tab) => tab.scopeId),
  );
  await Promise.allSettled(
    mine.map((tab) => {
      tab.busy = 0;
      return kept.has(tab.scopeId) || recent.has(tab.scopeId)
        ? undefined
        : sleepAgentTab(tab.scopeId);
    }),
  );
  forgetOldest();
}

export async function closeAgentTab(scopeId: string) {
  if (shownScope === scopeId) shownScope = undefined;
  await sleepAgentTab(scopeId, true);
  tabs.delete(scopeId);
  kept.delete(scopeId);
  removeBrowserTab(scopeId);
}

function forgetOldest() {
  const asleep = [...tabs.values()]
    .filter((tab) => !tab.viewId)
    .sort((a, b) => b.lastUsed - a.lastUsed);
  for (const tab of asleep.slice(KEEP_ASLEEP)) tabs.delete(tab.scopeId);
  if (![...tabs.values()].some((tab) => tab.viewId) && timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

export function resetAgentTabs() {
  tabs.clear();
  kept.clear();
  pending.clear();
  shownScope = undefined;
  resetMemoryPressure();
  if (timer) clearInterval(timer);
  timer = undefined;
}

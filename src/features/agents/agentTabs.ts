import { invoke } from "@tauri-apps/api/core";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { setBrowserRuntimeKeepLive } from "@/features/webviews/browserRuntime";
import {
  addBrowserTab,
  browserTabActed,
  finishTaskViews,
  removeBrowserTab,
  updateBrowserTab,
  viewOfTab,
  type AgentBrowserTab,
} from "./agentBrowser/agentBrowserStore";
import { followAgentPages } from "./agentBrowser/agentPageEvents";
import { livePagesAllowed, pressureLevel, resetMemoryPressure } from "./agentTabPressure";
import { agentPageBounds, restoredAgentTabs, type AgentTab } from "./agentTabRecords";

export { agentPageBounds, type AgentTab };

/**
 * An agent's tabs in the person's window, which sleep (docs/agents/browser.md,
 * "Memory"). Only the page an agent is acting on stays rendered; a tab it moved on from sleeps:
 * its address and title are kept, and its page closes through the one close path
 * (browser_webview_sleep → close_browser_webview), so its WebKit process goes too. A job on a
 * sleeping tab wakes it first under the same scope, so the agent's grants and refs carry on.
 *
 * Device-local and in memory only: agent tabs are not in the sync tree, and an app restart
 * starts clean. What the person sees of them (views, tabs, pictures) is agentBrowserStore.ts.
 *
 * Under memory pressure (system_memory_pressure) fewer pages stay live: idle tabs sleep at once,
 * and a wake first puts the page left longest to sleep, so views take turns instead of failing.
 */

const CHECK_MS = 5_000;
/** Sleeping tabs remembered, newest kept; each is a few hundred bytes. */
const KEEP_ASLEEP = 500;

const tabs = restoredAgentTabs();

/** One sleep or wake at a time per tab. */
const pending = new Map<string, Promise<unknown>>();
let timer: ReturnType<typeof setInterval> | undefined;
/** The tab the person is looking at in the split, which never sleeps. */
let shownScope: string | undefined;
/**
 * Tabs a run kept as proof (browser_run's keep(), docs/agents/harness.md, Completion): pages
 * the person asked to leave open. They stay awake when idle and when the run ends, so they show
 * at the end; only memory pressure puts them to sleep.
 */
const kept = new Set<string>();

/** Keeps a tab awake as proof of the run's answer. */
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

/**
 * A page an agent opened, in a chat's view: the main agent's (`view.id` its task) or a
 * sub-agent's (its own tab).
 */
export function trackAgentTab(
  tab: Pick<AgentTab, "scopeId" | "viewId" | "taskId" | "runId"> & {
    url?: string;
    conversationId?: string;
    view?: { id: string; label: string };
  },
) {
  const { conversationId, view, ...record } = tab;
  tabs.set(tab.scopeId, { url: "", title: "", ...record, lastUsed: Date.now(), busy: 0 });
  // The workspace's sweep hides, and a reload closes, any page no tab keeps (browserRuntime.ts).
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

/** Records a tab the agent browser knows of without a live page yet. */
export function rememberAgentTab(tab: AgentTab) {
  tabs.set(tab.scopeId, tab);
}

/** What an agent's live page reported (address, title, icon, loading), for its tab's row and
 * the agent browser's address. A sleeping tab wakes where the page last was. */
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
}

/** The tab the person looks at in the split, or none; it stays live while shown. */
export function setShownAgentTab(scopeId: string | undefined) {
  shownScope = scopeId;
  const tab = scopeId ? tabs.get(scopeId) : undefined;
  if (tab) tab.lastUsed = Date.now();
}

export const agentTab = (scopeId: string) => tabs.get(scopeId);
/** The tab whose live page this is. */
const agentTabOfView = (viewId: string) =>
  viewId ? [...tabs.values()].find((tab) => tab.viewId === viewId) : undefined;
export const agentTabsForTask = (taskId: string) =>
  [...tabs.values()].filter((tab) => tab.taskId === taskId);

/** Marks a job starting or ending on a tab. */
export function noteAgentTabJob(scopeId: string, runId: string, busy: boolean) {
  const tab = tabs.get(scopeId);
  if (!tab) return;
  tab.lastUsed = Date.now();
  tab.runId = runId || tab.runId;
  tab.busy = Math.max(0, tab.busy + (busy ? 1 : -1));
  if (busy) browserTabActed(scopeId);
}

/** Closes a tab's page and keeps where it was. */
export function sleepAgentTab(scopeId: string): Promise<void> {
  return serial(scopeId, async () => {
    const tab = tabs.get(scopeId);
    if (!tab?.viewId || tab.busy || scopeId === shownScope) return;
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

/**
 * Opens a sleeping tab's page again under its scope, bound to its task's lease, before a job
 * runs on it. A finished task's tab (its proof, kept for the person) has no lease left, so it
 * opens for viewing only, with no agent bound. False when the tab is unknown here or could not open.
 */
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
          theme: "dark",
          agentRunId: finished ? undefined : tab.runId,
          ...agentPageBounds(),
        },
      });
      if (!finished) await invoke("agent_workspace_bind_scope", { taskId: tab.taskId, scopeId });
      // Parked out of sight rather than hidden, so it keeps painting for the agent.
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

/** Under memory pressure, the live page left longest sleeps before another wakes. */
async function makeRoom(waking: string) {
  const budget = await livePagesAllowed();
  const live = [...tabs.values()].filter((tab) => tab.viewId && tab.scopeId !== waking);
  if (live.length < budget) return;
  const spare = live
    .filter((tab) => !tab.busy && tab.scopeId !== shownScope)
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, live.length - budget + 1);
  // Sleeping is serialized per tab, so call it outside the waking tab's own queue.
  await Promise.allSettled(spare.map((tab) => sleepAgentTab(tab.scopeId)));
}

/** Under memory pressure, sleeps every tab not in use or in view; otherwise all pages stay live. */
export async function sleepIdleAgentTabs() {
  if ((await pressureLevel()) !== "normal") {
    await Promise.allSettled(
      [...tabs.values()]
        .filter((tab) => tab.viewId && !tab.busy)
        .map((tab) => sleepAgentTab(tab.scopeId)),
    );
  }
  // Otherwise every page stays live: WebKit stops a page that is closed, and the agent browser
  // must keep painting whichever tab the agent returns to.
}

/** Tabs a finished run leaves awake without keep(): what it left open is its answer. */
const AWAKE_AT_END = 8;

/**
 * Sleeps a task's tabs when its run ended, and its tabs stay as proof. The tabs it used last stay
 * awake (a run that leaves pages open does so for the person to see them, whether or not it
 * marked each with keep()), so they show at the end; the rest sleep.
 */
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

/** Closes one tab for good: the agent closed it. */
export async function closeAgentTab(scopeId: string) {
  if (shownScope === scopeId) shownScope = undefined;
  await sleepAgentTab(scopeId);
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

/** For tests. */
export function resetAgentTabs() {
  tabs.clear();
  kept.clear();
  pending.clear();
  shownScope = undefined;
  resetMemoryPressure();
  if (timer) clearInterval(timer);
  timer = undefined;
}

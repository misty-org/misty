import { invoke } from "@tauri-apps/api/core";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { setBrowserRuntimeKeepLive } from "@/features/webviews/browserRuntime";
import {
  addBrowserTab,
  browserTabActed,
  finishTaskViews,
  removeBrowserTab,
  setViewPicture,
  updateBrowserTab,
  viewOfTab,
} from "./agentBrowser/agentBrowserStore";

/**
 * An agent's tabs in the person's window, which sleep (docs/design/agent-browser/BRIEF.md,
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
export interface AgentTab {
  scopeId: string;
  /** The live page's id, or "" while the tab sleeps. */
  viewId: string;
  taskId: string;
  runId: string;
  url: string;
  title: string;
  lastUsed: number;
  /** Jobs running on it now; a tab in use never sleeps. */
  busy: number;
}

/** A tab the agent left this long ago sleeps, unless it is its task's most recent one. */
export const SLEEP_AFTER_MS = 20_000;
const CHECK_MS = 5_000;
/** Sleeping tabs remembered, newest kept; each is a few hundred bytes. */
const KEEP_ASLEEP = 500;

const tabs = new Map<string, AgentTab>();
/** One sleep or wake at a time per tab. */
const pending = new Map<string, Promise<unknown>>();
let timer: ReturnType<typeof setInterval> | undefined;
/** The tab the person is looking at in the split, which never sleeps. */
let shownScope: string | undefined;
/** Live agent pages the system can spare now, by memory pressure. */
const LIVE_UNDER_PRESSURE = { normal: Infinity, warning: 2, critical: 1 } as const;
let pressure: { level: keyof typeof LIVE_UNDER_PRESSURE; at: number } = { level: "normal", at: 0 };
const PICTURE_EVERY_MS = 2_000;
const pictured = new Map<string, number>();

const serial = <T>(scopeId: string, work: () => Promise<T>): Promise<T> => {
  const next = (pending.get(scopeId) ?? Promise.resolve()).then(work, work);
  pending.set(scopeId, next.catch(() => undefined));
  return next;
};

/** The size a hidden agent page renders at: about the person's page area. */
export const agentPageBounds = () => ({
  x: 0,
  y: 64,
  width: Math.max(200, window.innerWidth - 440),
  height: Math.max(300, window.innerHeight - 128),
});

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
    addBrowserTab(conversationId, { ...(view ?? { id: tab.taskId, label: "Main" }), taskId: tab.taskId }, {
      scopeId: tab.scopeId,
      url: tab.url ?? "",
      title: "",
      asleep: false,
    });
  timer ??= setInterval(() => void sleepIdleAgentTabs(), CHECK_MS);
}

/** The tab the person looks at in the split, or none; it stays live while shown. */
export function setShownAgentTab(scopeId: string | undefined) {
  shownScope = scopeId;
  const tab = scopeId ? tabs.get(scopeId) : undefined;
  if (tab) tab.lastUsed = Date.now();
}

async function pressureLevel(): Promise<keyof typeof LIVE_UNDER_PRESSURE> {
  if (Date.now() - pressure.at < 5_000) return pressure.level;
  const level = await invoke<string>("system_memory_pressure").catch(() => "normal");
  pressure = { level: level === "critical" || level === "warning" ? level : "normal", at: Date.now() };
  return pressure.level;
}

export const agentTab = (scopeId: string) => tabs.get(scopeId);
export const agentTabsForTask = (taskId: string) => [...tabs.values()].filter((tab) => tab.taskId === taskId);

/** Marks a job starting or ending on a tab. */
export function noteAgentTabJob(scopeId: string, runId: string, busy: boolean) {
  const tab = tabs.get(scopeId);
  if (!tab) return;
  tab.lastUsed = Date.now();
  tab.runId = runId || tab.runId;
  tab.busy = Math.max(0, tab.busy + (busy ? 1 : -1));
  if (busy) browserTabActed(scopeId);
}

/** A small picture of a tab after the agent's step, for its view's switcher and the PiP. */
export async function pictureAgentTab(scopeId: string) {
  const tab = tabs.get(scopeId);
  const view = viewOfTab(scopeId)?.view;
  if (!tab?.viewId || !view || Date.now() - (pictured.get(view.id) ?? 0) < PICTURE_EVERY_MS) return;
  pictured.set(view.id, Date.now());
  const picture = await invoke<{ dataUrl?: string }>("browser_webview_picture", { request: { id: tab.viewId } }).catch(
    () => undefined,
  );
  if (picture?.dataUrl) setViewPicture(view.id, picture.dataUrl);
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
    updateBrowserTab(scopeId, { asleep: true, url: tab.url, title: tab.title });
  });
}

/**
 * Opens a sleeping tab's page again under its scope, bound to its task's lease, before a job
 * runs on it. False when the tab is unknown here or its task's lease has ended.
 */
export function wakeAgentTab(scopeId: string): Promise<boolean> {
  return serial(scopeId, async () => {
    const tab = tabs.get(scopeId);
    if (!tab) return false;
    if (tab.viewId) return true;
    await makeRoom(scopeId);
    const id = `agent-${crypto.randomUUID()}`;
    try {
      await invoke("browser_webview_create", {
        request: {
          id,
          scopeId,
          url: tab.url || browserHomeUrl(),
          originSpaceId: "",
          theme: "dark",
          agentRunId: tab.runId,
          ...agentPageBounds(),
        },
      });
      await invoke("agent_workspace_bind_scope", { taskId: tab.taskId, scopeId });
      // Parked out of sight rather than hidden, so it keeps painting for the agent.
      await invoke("browser_webview_hide", { request: { id, keepLive: true } });
    } catch {
      await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
      return false;
    }
    tab.viewId = id;
    tab.lastUsed = Date.now();
    setBrowserRuntimeKeepLive(id, true);
    updateBrowserTab(scopeId, { asleep: false });
    return true;
  });
}

/** Under memory pressure, the live page left longest sleeps before another wakes. */
async function makeRoom(waking: string) {
  const budget = LIVE_UNDER_PRESSURE[await pressureLevel()];
  const live = [...tabs.values()].filter((tab) => tab.viewId && tab.scopeId !== waking);
  if (live.length < budget) return;
  const spare = live
    .filter((tab) => !tab.busy && tab.scopeId !== shownScope)
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, live.length - budget + 1);
  // Sleeping is serialized per tab, so call it outside the waking tab's own queue.
  await Promise.allSettled(spare.map((tab) => sleepAgentTab(tab.scopeId)));
}

/** Sleeps every tab its agent left a while ago, keeping each task's most recent one; under
 * memory pressure, every tab not in use or in view. */
export async function sleepIdleAgentTabs(now = Date.now()) {
  if ((await pressureLevel()) !== "normal") {
    await Promise.allSettled(
      [...tabs.values()].filter((tab) => tab.viewId && !tab.busy).map((tab) => sleepAgentTab(tab.scopeId)),
    );
    return;
  }
  const newest = new Map<string, AgentTab>();
  for (const tab of tabs.values())
    if (tab.viewId && (!newest.has(tab.taskId) || tab.lastUsed > newest.get(tab.taskId)!.lastUsed))
      newest.set(tab.taskId, tab);
  const idle = [...tabs.values()].filter(
    (tab) => tab.viewId && !tab.busy && now - tab.lastUsed >= SLEEP_AFTER_MS && newest.get(tab.taskId) !== tab,
  );
  await Promise.allSettled(idle.map((tab) => sleepAgentTab(tab.scopeId)));
}

/** Sleeps all of a task's tabs: its run ended, and its tabs stay as proof. */
export async function sleepTaskTabs(taskId: string) {
  finishTaskViews(taskId);
  await Promise.allSettled(
    agentTabsForTask(taskId).map((tab) => {
      tab.busy = 0;
      return sleepAgentTab(tab.scopeId);
    }),
  );
  forgetOldest();
}

/** Closes one tab for good: the agent closed it. */
export async function closeAgentTab(scopeId: string) {
  if (shownScope === scopeId) shownScope = undefined;
  await sleepAgentTab(scopeId);
  tabs.delete(scopeId);
  removeBrowserTab(scopeId);
}

function forgetOldest() {
  const asleep = [...tabs.values()].filter((tab) => !tab.viewId).sort((a, b) => b.lastUsed - a.lastUsed);
  for (const tab of asleep.slice(KEEP_ASLEEP)) tabs.delete(tab.scopeId);
  if (![...tabs.values()].some((tab) => tab.viewId) && timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** For tests. */
export function resetAgentTabs() {
  tabs.clear();
  pending.clear();
  pictured.clear();
  shownScope = undefined;
  pressure = { level: "normal", at: 0 };
  if (timer) clearInterval(timer);
  timer = undefined;
}

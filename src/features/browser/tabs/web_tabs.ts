import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  browserHomeUrl,
  setBrowserRuntimeKeepLive,
  useWorkspaceStore,
  workspaceTabsById,
} from "@/features/app-windows";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { forgetPageMedia } from "../media/page_media";
import {
  prewarmTurn,
  shownPageBox,
  shownPageSize,
  whenPageHostShown,
  type PageBox,
} from "./page_prewarm";
import { webAddress, webHomeUrl } from "./web_address";
import { addPermissionAsk, answerPermission, type WebPermissionAsk } from "./web_permissions";
import {
  dropWebTab,
  ensureWebTab,
  updateWebTab,
  useWebTabs,
  webTab,
  webTabOfView,
} from "./web_tab_store";

export const webTabRoutePrefix = "/browser/";

export const newWebTabRoute = () => `${webTabRoutePrefix}web-${crypto.randomUUID()}`;

export function webTabRouteFor(url: string): string {
  const route = newWebTabRoute();
  ensureWebTab(webTabIdOfRoute(route), url);
  return route;
}

export function webTabIdOfRoute(route: string): string {
  const path = route.split(/[?#]/)[0];
  if (!path.startsWith(webTabRoutePrefix)) return "";
  const id = path.slice(webTabRoutePrefix.length);
  return /^web-[\w-]{8,64}$/.test(id) ? id : "";
}

const web = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);
const pending = new Map<string, Promise<boolean>>();
let following = false;

type SparePage = {
  viewId: string;
  ready: boolean;
  title: string;
  faviconUrl?: string;
  loading: boolean;
};
let spare: SparePage | null = null;

export function prepareSparePage() {
  if (spare || !hasTauriInternals()) return;
  followPages();
  const page: SparePage = {
    viewId: `page-${crypto.randomUUID()}`,
    ready: false,
    title: "",
    loading: true,
  };
  spare = page;
  const turn = prewarmTurn();
  void turn.ready
    .then(() => openPage(page.viewId, `web-scope-spare-${page.viewId}`, webHomeUrl, "", null))
    .then((open) => {
      if (spare === page && open) page.ready = true;
      else if (spare === page) spare = null;
      else if (open) closePage(page.viewId);
    })
    .finally(() => turn.release());
}

function takeSparePage(): SparePage | null {
  if (!spare?.ready) return null;
  const page = spare;
  spare = null;
  return page;
}

const sparePage = (viewId: string) => (spare?.viewId === viewId ? spare : null);

function dropSparePage() {
  const page = spare;
  spare = null;
  if (page?.ready) closePage(page.viewId);
}

function closePage(viewId: string) {
  setBrowserRuntimeKeepLive(viewId, false);
  void invoke("browser_webview_close", { request: { id: viewId } }).catch(() => undefined);
}

async function refreshNav(id: string) {
  const tab = webTab(id);
  if (!tab?.viewId) return;
  const state = await invoke<{ canGoBack: boolean; canGoForward: boolean }>(
    "browser_webview_nav_state",
    { request: { id: tab.viewId } },
  ).catch(() => null);
  if (state) updateWebTab(id, { canGoBack: state.canGoBack, canGoForward: state.canGoForward });
}

function followPages() {
  if (following || !hasTauriInternals()) return;
  following = true;
  void Promise.all([
    listen<{ id: string; url: string; phase: "started" | "finished" | "navigated" }>(
      "misty://browser-page",
      ({ payload }) => {
        const waiting = sparePage(payload.id);
        if (waiting && payload.phase !== "navigated") waiting.loading = payload.phase === "started";
        const tab = webTabOfView(payload.id);
        if (!tab) return;
        const url = web(payload.url) ? payload.url : undefined;
        if (payload.phase === "started")
          updateWebTab(tab.id, { loading: true, failure: undefined, ...(url && { url }) });
        else
          updateWebTab(tab.id, {
            ...(url && { url }),
            ...(payload.phase === "finished" && { loading: false }),
          });
        if (payload.phase === "finished" && url)
          void invoke("browser_history_record", {
            request: { url, title: webTab(tab.id)?.title ?? "", typed: false },
          }).catch(() => undefined);
        void refreshNav(tab.id);
      },
    ),
    listen<{ id: string; url: string; offline: boolean; message: string }>(
      "misty://browser-page-failed",
      ({ payload }) => {
        if (sparePage(payload.id)) dropSparePage();
        const tab = webTabOfView(payload.id);
        if (!tab) return;
        const url = web(payload.url) ? payload.url : tab.url;
        updateWebTab(tab.id, {
          loading: false,
          url,
          failure: { url, offline: payload.offline, message: payload.message },
        });
      },
    ),
    listen<WebPermissionAsk>("misty://browser-permission", ({ payload }) => {
      if (webTabOfView(payload.page)) addPermissionAsk(payload);
      else answerPermission(payload.id, false, false);
    }),
    listen<{ id: string }>("misty://browser-stopped", ({ payload }) => {
      const waiting = sparePage(payload.id);
      if (waiting) waiting.loading = false;
      const tab = webTabOfView(payload.id);
      if (tab) updateWebTab(tab.id, { loading: false });
    }),
    listen<{ id: string; title: string }>("misty://browser-title", ({ payload }) => {
      const tab = webTabOfView(payload.id);
      const title = payload.title.trim();
      const waiting = sparePage(payload.id);
      if (waiting && title) waiting.title = title;
      if (!tab || !title) return;
      updateWebTab(tab.id, { title });
      if (web(tab.url))
        void invoke("browser_history_set_title", { request: { url: tab.url, title } }).catch(
          () => undefined,
        );
    }),
    listen<{ id: string; url: string }>("misty://browser-favicon", ({ payload }) => {
      const waiting = sparePage(payload.id);
      if (waiting && web(payload.url)) waiting.faviconUrl = payload.url;
      const tab = webTabOfView(payload.id);
      if (tab && web(payload.url)) updateWebTab(tab.id, { faviconUrl: payload.url });
    }),
  ]).catch(() => {
    following = false;
  });
  watchClosedTabs();
}

async function openPage(
  viewId: string,
  scopeId: string,
  url: string,
  spaceId: string,
  shown: PageBox | null,
  host?: HTMLElement | null,
) {
  try {
    await invoke("browser_webview_create", {
      request: {
        id: viewId,
        scopeId,
        url,
        originSpaceId: spaceId,
        parked: !shown,
        ...(shown ?? shownPageSize()),
      },
    });
    if (!shown || (host !== undefined && !shownPageBox(host)))
      await invoke("browser_webview_hide", { request: { id: viewId, keepLive: true } });
  } catch {
    await invoke("browser_webview_close", { request: { id: viewId } }).catch(() => undefined);
    return false;
  }
  setBrowserRuntimeKeepLive(viewId, true);
  return true;
}

export function wakeWebTab(
  id: string,
  spaceId: string,
  host?: HTMLElement | null,
): Promise<boolean> {
  const tab = ensureWebTab(id);
  if (tab.viewId) return Promise.resolve(true);
  const running = pending.get(id);
  if (running) return running;
  followPages();
  const work = (async () => {
    const turn = host && !shownPageBox(host) ? prewarmTurn() : null;
    try {
      if (turn && host) {
        const shown = whenPageHostShown(host);
        await Promise.race([turn.ready, shown.shown]);
        shown.stop();
      }
      const current = webTab(id);
      if (!current) return false;
      if (current.viewId) return true;
      const url = current.url || browserHomeUrl();
      const page = takeSparePage();
      prepareSparePage();
      if (page && (await adoptSparePage(page, id, current.scopeId, url, spaceId, host)))
        return true;
      const viewId = `page-${crypto.randomUUID()}`;
      if (!(await openPage(viewId, current.scopeId, url, spaceId, shownPageBox(host), host ?? null)))
        return false;
      updateWebTab(id, { viewId, spaceId, zoom: 1 });
      return true;
    } finally {
      turn?.release();
    }
  })().finally(() => pending.delete(id));
  pending.set(id, work);
  return work;
}

async function adoptSparePage(
  page: SparePage,
  id: string,
  scopeId: string,
  url: string,
  spaceId: string,
  host?: HTMLElement | null,
) {
  if (!(await openPage(page.viewId, scopeId, url, spaceId, shownPageBox(host), host ?? null)))
    return false;
  const home = url === webHomeUrl;
  updateWebTab(id, {
    viewId: page.viewId,
    spaceId,
    zoom: 1,
    loading: home ? page.loading : true,
    ...(home && page.title && { title: page.title }),
    ...(home && page.faviconUrl && { faviconUrl: page.faviconUrl }),
  });
  if (!home)
    await invoke("browser_webview_navigate", { request: { id: page.viewId, url } }).catch(() =>
      updateWebTab(id, { loading: false }),
    );
  return true;
}

export async function goTo(id: string, typed: string, spaceId: string) {
  const url = webAddress(typed);
  if (!url) return;
  const tab = ensureWebTab(id);
  void invoke("browser_history_record", { request: { url, title: "", typed: true } }).catch(
    () => undefined,
  );
  if (!tab.viewId) {
    updateWebTab(id, { url });
    await wakeWebTab(id, spaceId);
    return;
  }
  updateWebTab(id, { url, loading: true, failure: undefined });
  await invoke("browser_webview_navigate", { request: { id: tab.viewId, url } }).catch(() =>
    updateWebTab(id, { loading: false }),
  );
}

const pageCommand = (id: string, command: string) => {
  const viewId = webTab(id)?.viewId;
  if (viewId) void invoke(command, { request: { id: viewId } }).catch(() => undefined);
};

export const goBack = (id: string) => pageCommand(id, "browser_webview_back");
export const goForward = (id: string) => pageCommand(id, "browser_webview_forward");
export function reload(id: string) {
  const tab = webTab(id);
  if (tab?.failure && tab.viewId) {
    updateWebTab(id, { failure: undefined, loading: true });
    void invoke("browser_webview_navigate", {
      request: { id: tab.viewId, url: tab.failure.url },
    }).catch(() => updateWebTab(id, { loading: false }));
    return;
  }
  pageCommand(id, "browser_webview_reload");
}
export const stopLoading = (id: string) => pageCommand(id, "browser_webview_stop");

export function setZoom(id: string, zoom: number) {
  const tab = webTab(id);
  const factor = Math.round(Math.min(3, Math.max(0.5, zoom)) * 100) / 100;
  if (!tab?.viewId) return;
  updateWebTab(id, { zoom: factor });
  void invoke("browser_webview_set_zoom", { request: { id: tab.viewId, factor } }).catch(
    () => undefined,
  );
}

export function findInPage(
  id: string,
  query: string,
  direction: "next" | "previous" | "clear",
  matchCase: boolean,
): Promise<{ current: number; total: number }> {
  const viewId = webTab(id)?.viewId;
  if (!viewId) return Promise.resolve({ current: 0, total: 0 });
  return invoke<{ current: number; total: number }>("browser_webview_find", {
    request: { id: viewId, query, direction, matchCase },
  }).catch(() => ({ current: 0, total: 0 }));
}

export function closeWebTab(id: string) {
  const viewId = webTab(id)?.viewId;
  dropWebTab(id);
  if (!viewId) return;
  forgetPageMedia({ kind: "browser", id: viewId });
  setBrowserRuntimeKeepLive(viewId, false);
  void invoke("browser_webview_close", { request: { id: viewId } }).catch(() => undefined);
}

let watching = false;

function watchClosedTabs() {
  if (watching) return;
  watching = true;
  useWorkspaceStore.subscribe((state) => {
    const open = new Set(
      [...workspaceTabsById(state).values()]
        .map((view) => webTabIdOfRoute(view.route))
        .filter(Boolean),
    );
    for (const id of Object.keys(useWebTabs.getState().tabs)) if (!open.has(id)) closeWebTab(id);
  });
}

export function openWebTabs(): { scopeId: string; url: string; title: string }[] {
  return Object.values(useWebTabs.getState().tabs)
    .filter((tab) => web(tab.url))
    .map((tab) => ({ scopeId: tab.scopeId, url: tab.url, title: tab.title }));
}

export const webTabOfScope = (scopeId: string) =>
  Object.values(useWebTabs.getState().tabs).find((tab) => tab.scopeId === scopeId);

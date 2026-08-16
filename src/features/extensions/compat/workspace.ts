import { browserPageTools } from "@/features/browser";
import { browserRuntimeIdForTabId } from "@/features/webviews/browserRuntime";
import {
  activeLayoutView,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import {
  browserSearchEngine,
  browserSearchEngines,
  browserSearchUrl,
} from "@/features/workspace/browserSearchEngine";
import { compatObject, type CompatCaller, type CompatHandler } from "./events";
import { systemHandlers } from "./system";

function activeBrowserRuntime(): string {
  const view = activeLayoutView(useWorkspaceStore.getState().layout);
  const runtime = view?.surfaceId === "browser" ? browserRuntimeIdForTabId(view.id) : null;
  if (!runtime) throw new Error("Open a browser tab first.");
  return runtime;
}

function closedBrowserTabs(caller: CompatCaller) {
  return useWorkspaceStore
    .getState()
    .closedItems.map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (item.view.surfaceId !== "browser") return false;
      return caller.privateAccess || !parseBrowserViewState(item.view.state).private;
    });
}

function session(view: WorkspaceView) {
  const state = parseBrowserViewState(view.state);
  return {
    lastModified: 0,
    tab: {
      sessionId: view.id,
      url: state.url ?? "about:blank",
      title: view.title ?? "",
      incognito: state.private ?? false,
      active: false,
      highlighted: false,
      pinned: false,
      index: 0,
      windowId: -1,
    },
  };
}

export const workspaceHandlers: Record<string, CompatHandler> = {
  ...systemHandlers,
  "search.get": () =>
    browserSearchEngines.map((engine) => ({
      name: engine.name,
      isDefault: engine.id === browserSearchEngine().id,
    })),
  "search.search": ([value]) => {
    const details = compatObject(value);
    const query = String(details.query ?? details.text ?? "").trim();
    if (!query) throw new Error("A search query is required.");
    const engine = browserSearchEngines.find((candidate) => candidate.name === details.engine);
    if (details.engine !== undefined && !engine)
      throw new Error(`No search engine named ${String(details.engine)}.`);
    const url = engine
      ? engine.search.replace("%s", encodeURIComponent(query))
      : browserSearchUrl(query);
    const workspace = useWorkspaceStore.getState();
    const current = activeLayoutView(workspace.layout);
    const disposition =
      details.disposition ?? (details.tabId !== undefined ? "CURRENT_TAB" : "NEW_TAB");
    if (disposition === "CURRENT_TAB" && current?.surfaceId === "browser") {
      workspace.updateBrowserView(current.id, { url });
      return;
    }
    if (disposition === "NEW_WINDOW") workspace.createWindow();
    useWorkspaceStore.getState().openBrowserView({ url, private: false });
  },
  "sessions.getRecentlyClosed": ([filter], caller) => {
    const max = Number(compatObject(filter).maxResults);
    const limit = max > 0 ? Math.min(max, 25) : 25;
    return closedBrowserTabs(caller)
      .slice(0, limit)
      .map(({ item }) => session(item.view));
  },
  "sessions.restore": ([sessionId], caller) => {
    const closed = closedBrowserTabs(caller);
    const match =
      sessionId === undefined ? closed[0] : closed.find(({ item }) => item.view.id === sessionId);
    if (!match) throw new Error("That closed tab is no longer available.");
    const restored = useWorkspaceStore.getState().reopenClosedView(match.index);
    if (!restored) throw new Error("That closed tab could not be restored.");
    return session(restored);
  },
  "sessions.forgetClosedTab": ([, sessionId]) => {
    useWorkspaceStore.setState((state) => ({
      closedItems: state.closedItems.filter((item) => item.view.id !== sessionId),
    }));
  },
  "find.find": async ([query]) => {
    const result = await browserPageTools.find(activeBrowserRuntime(), String(query), "next");
    return { count: result.total };
  },
  "find.clear": async () => {
    await browserPageTools.find(activeBrowserRuntime(), "", "clear");
  },
};

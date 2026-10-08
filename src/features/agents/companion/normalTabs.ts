import { browserHomeUrl } from "@/features/workspace/browserHome";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { activeLayoutView, allLayoutViews } from "@/features/workspace/layoutTabs";
import type { WorkspaceView } from "@/features/workspace";
import { browserRuntimeCreated, browserScopeId } from "@/features/webviews/browserRuntime";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import type { Execution } from "../localExecution";

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter((word) => !commonWords.has(word)),
  );
const commonWords = new Set([
  "the",
  "and",
  "with",
  "your",
  "open",
  "tab",
  "page",
  "https",
  "www",
  "com",
]);

/**
 * The open browser tab a request means, across every tab in this window: the
 * one whose title or address shares the most words with what the agent said
 * it needs, then the focused one, then the one the user used most recently.
 */
function pickBrowserTab(views: WorkspaceView[], focused: WorkspaceView | null, hint: string) {
  const wanted = words(hint);
  const score = (view: WorkspaceView) => {
    const url = (view.state as { url?: unknown } | null)?.url;
    const have = words(`${view.title} ${typeof url === "string" ? url : ""}`);
    return [...wanted].filter((word) => have.has(word)).length;
  };
  return [...views].sort(
    (a, b) =>
      score(b) - score(a) ||
      Number(b.id === focused?.id) - Number(a.id === focused?.id) ||
      b.lastFocusedAt - a.lastFocusedAt,
  )[0];
}

/**
 * The browser tab in front of the user: the focused pane's tab, when it is a
 * live page. Private tabs never count.
 */
export function currentBrowserTab(): WorkspaceView | undefined {
  const view = activeLayoutView(useWorkspaceStore.getState().layout);
  if (!view || view.surfaceId !== "browser" || !browserRuntimeCreated(view)) return undefined;
  return (view.state as { private?: unknown } | null)?.private === true ? undefined : view;
}

/** The tab in front of the user as plain page data for a request, or nothing. */
export function currentTabSummary(): { title: string; url: string } | undefined {
  const view = currentBrowserTab();
  const url = (view?.state as { url?: unknown } | null)?.url;
  if (!view || typeof url !== "string" || !/^https?:\/\//.test(url)) return undefined;
  return { title: view.title.slice(0, 300), url: url.slice(0, 2048) };
}

/**
 * Bind the user's own browser tab. Never create a private execution webview.
 * `place` "new" always opens a fresh tab; "current" binds the tab in front of
 * the user. Without it, the open tab that best matches the request is used.
 */
export async function companionBrowserContext(
  assertCurrent: () => void,
  openWhenMissing = false,
  url?: string,
  hint = "",
  tabId?: string,
  place?: "current" | "new",
): Promise<Pick<Execution, "context" | "deviceContexts">> {
  assertCurrent();
  const workspace = useWorkspaceStore.getState();
  const open = allLayoutViews(workspace.layout).filter(
    (t) => t.surfaceId === "browser" && browserRuntimeCreated(t),
  );
  // A follow-up names the exact tab its run worked in; use it while it is open.
  const exact = tabId ? open.find((t) => t.id === tabId) : undefined;
  let tab: WorkspaceView | undefined =
    place === "new"
      ? exact
      : (exact ??
        (place === "current" ? currentBrowserTab() : undefined) ??
        pickBrowserTab(open, activeLayoutView(workspace.layout), `${hint} ${url ?? ""}`));
  // A question must never open a tab as a side effect of assembling context.
  if (!tab && (openWhenMissing || place === "new")) {
    assertCurrent();
    tab = workspace.openBrowserView({ url: url || browserHomeUrl() });
    const deadline = Date.now() + 8000;
    while (!browserRuntimeCreated(tab)) {
      assertCurrent();
      if (Date.now() >= deadline)
        throw new Error("The browser tab did not finish opening. Try again.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!tab) return { context: [], deviceContexts: [] };
  const snapshot = await agentsDeviceSnapshot();
  assertCurrent();
  if (!snapshot.device || snapshot.device.status === "revoked")
    throw new Error("This Misty device is unavailable.");
  const device = await ensureServerAgentDevice(snapshot.device);
  assertCurrent();
  const scopeId = browserScopeId(tab);
  return {
    context: [
      {
        id: tab.id,
        kind: "browser-tab",
        title: tab.title || "Current browser tab",
        source: "current",
        privacy: "device",
        attached: true,
        opaqueScopeId: scopeId,
      },
    ],
    deviceContexts: [
      {
        deviceId: device.id,
        kind: "browser_tab",
        opaqueRef: scopeId,
        displayName: tab.title || "Current browser tab",
        capabilities: [
          "browser.inspect",
          "browser.visual",
          "browser.navigate",
          "browser.act",
          "browser.downloads.list",
          "browser.upload",
        ],
        metadata: { app_id: "browser", window_label: "main", normal_tab: true, tab_id: tab.id },
      },
    ],
  };
}

import { browserHomeUrl } from "@/features/workspace/browserHome";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { browserRuntimeCreated, browserScopeId } from "@/features/webviews/browserRuntime";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import type { Execution } from "../localExecution";

/** Bind the actual visible browser tab. Never create a private execution webview. */
export async function companionBrowserContext(
  assertCurrent: () => void,
  openWhenMissing = false,
): Promise<Pick<Execution, "context" | "deviceContexts">> {
  assertCurrent();
  const workspace = useWorkspaceStore.getState();
  const panes = dockLeaves(workspace.layout.root);
  const pane = panes.find((p) => p.id === workspace.layout.focusedPaneId) ?? panes[0];
  let tab = pane?.tabs.find((t) => t.id === pane.activeTabId && t.surfaceId === "browser");
  if (!tab)
    tab = panes
      .flatMap((p) => p.tabs)
      .find((t) => t.surfaceId === "browser" && browserRuntimeCreated(t));
  // A question must never open a tab as a side effect of assembling context.
  if (!tab && openWhenMissing) {
    assertCurrent();
    tab = workspace.openBrowserTab({ url: browserHomeUrl() });
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
          "browser.click",
          "browser.interact",
          "browser.downloads.list",
          "browser.upload",
        ],
        metadata: { app_id: "browser", window_label: "main", normal_tab: true, tab_id: tab.id },
      },
    ],
  };
}

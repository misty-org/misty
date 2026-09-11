import { inheritProviderBrowser } from "./browserProviders";
import { MistyBrowserUrlSchema } from "@misty/sdk";
import { allLayoutPanes } from "@/features/workspace/layoutTabs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { browserRuntimeIdForTabId, browserTabIdForRuntime } from "./browserRuntime";

/** Native popups belong beside a live source in the current workspace. */
export function openBrowserPopup(payload: {
  sourceId: string;
  url: string;
  popupInstanceKey?: string;
}) {
  const url = MistyBrowserUrlSchema.safeParse(payload.url);
  const sourceTabId = browserTabIdForRuntime(payload.sourceId);
  if (!url.success || !sourceTabId || browserRuntimeIdForTabId(sourceTabId) !== payload.sourceId)
    return null;
  const store = useWorkspaceStore.getState();
  const source = allLayoutPanes(store.layout)
    .flatMap((pane) => pane.tabs)
    .find((tab) => tab.id === sourceTabId);
  if (!source) return null;
  // A live, registered browser owns this popup regardless of its App's type.
  // Adopt the original native window to retain its opener and account profile.
  if (url.data === "about:blank" && !payload.popupInstanceKey) return null;
  const tab = store.openBrowserTab({ url: url.data, sourceTabId });
  if (tab) inheritProviderBrowser(tab.id, payload.sourceId, url.data, payload.popupInstanceKey);
  return tab;
}

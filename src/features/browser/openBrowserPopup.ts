import { MistyBrowserUrlSchema } from "@misty/sdk";
import { dockLeaves } from "@/features/workspace/dockTree";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { browserRuntimeIdForTabId, browserTabIdForRuntime } from "./browserRuntime";

/** Native popups belong beside a live source in the current workspace. */
export function openBrowserPopup(payload: { sourceId: string; url: string }) {
  const url = MistyBrowserUrlSchema.safeParse(payload.url);
  const sourceTabId = browserTabIdForRuntime(payload.sourceId);
  if (!url.success || !sourceTabId || browserRuntimeIdForTabId(sourceTabId) !== payload.sourceId)
    return null;
  const store = useWorkspaceStore.getState();
  const source = dockLeaves(store.layout.root)
    .flatMap((pane) => pane.tabs)
    .find((tab) => tab.id === sourceTabId);
  if (
    !source ||
    !(
      source.surfaceId === "browser" ||
      (source.surfaceId === "official-app" && source.groupKey === "app:browser")
    )
  )
    return null;
  return store.openBrowserTab({ url: url.data, sourceTabId });
}

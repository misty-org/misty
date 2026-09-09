import {
  providerBrowserProfile,
  inheritProviderBrowser,
} from "./browserProviders";
import { MistyBrowserUrlSchema } from "@misty/sdk";
import { dockLeaves } from "@/features/workspace/dockTree";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  browserRuntimeIdForTabId,
  browserTabIdForRuntime,
} from "./browserRuntime";

/** Native popups belong beside a live source in the current workspace. */
export function openBrowserPopup(payload: {
  sourceId: string;
  url: string;
  popupInstanceKey?: string;
}) {
  const url = MistyBrowserUrlSchema.safeParse(payload.url);
  const sourceTabId = browserTabIdForRuntime(payload.sourceId);
  if (
    !url.success ||
    !sourceTabId ||
    browserRuntimeIdForTabId(sourceTabId) !== payload.sourceId
  )
    return null;
  const store = useWorkspaceStore.getState();
  const source = dockLeaves(store.layout.root)
    .flatMap((pane) => pane.tabs)
    .find((tab) => tab.id === sourceTabId);
  if (
    !source ||
    !(
      source.surfaceId === "browser" ||
      (source.surfaceId === "official-app" &&
        (source.groupKey === "app:browser" ||
          !!providerBrowserProfile(payload.sourceId)))
    )
  )
    return null;
  // Native integration sign-in windows stay with their opener and do not emit
  // this event. Browser events (including legacy provider popup events) retain
  // their native window/opener and account profile during tab adoption.
  if (url.data === "about:blank" && !payload.popupInstanceKey) return null;
  const tab = store.openBrowserTab({ url: url.data, sourceTabId });
  if (tab)
    inheritProviderBrowser(
      tab.id,
      payload.sourceId,
      url.data,
      payload.popupInstanceKey,
    );
  return tab;
}

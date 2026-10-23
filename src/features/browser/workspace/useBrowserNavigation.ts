import { useShortcutHandler } from "@/features/shortcuts";
import {
  browserInternalPage,
  browserViewTitle,
  createBrowserViewState,
  dockLeaves,
  useWorkspaceStore,
  type parseBrowserViewState,
  type WorkspaceView,
} from "@/features/workspace";
import { invoke } from "@tauri-apps/api/core";
import { normalizeBrowserAddress } from "@/features/browser-sync/address";
import { setBrowserError } from "./browserErrors";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";

/** Address navigation, back and forward, reload, and the shortcuts that drive them. */
export function useBrowserNavigation({
  tab,
  state,
  nativeRuntime,
  internalPage,
  onEditAddress,
}: {
  tab: WorkspaceView;
  state: ReturnType<typeof parseBrowserViewState>;
  nativeRuntime: boolean;
  internalPage: ReturnType<typeof browserInternalPage>;
  onEditAddress: () => void;
}) {
  const navigateActiveTab = (rawAddress: string) => {
    useWorkspaceStore.getState().commitPlaceholder(tab.id);
    const url = normalizeBrowserAddress(rawAddress);
    useWorkspaceStore.getState().updateBrowserView(tab.id, {
      ...createBrowserViewState(url),
      title: browserViewTitle(url),
    });
    useBrowserRuntimeStore.getState().pushHistory(tab.id, url);
    // Misty draws its own pages; the hidden native page keeps its place.
    if (browserInternalPage(url)) return;
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    if (nativeRuntime && browserRuntimeCreated(tab)) {
      void invoke("browser_webview_navigate", {
        request: {
          id: browserRuntimeId(tab),
          url,
        },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
    }
  };
  const travel = (direction: -1 | 1): boolean => {
    const step = useBrowserRuntimeStore.getState().travelHistory(tab.id, direction);
    if (!step) return false;
    const url = step.url;
    const leavingInternalPage = browserInternalPage(state.url) !== null;
    useWorkspaceStore.getState().updateBrowserView(tab.id, {
      url,
      title: browserViewTitle(url),
    });
    if (browserInternalPage(url)) return true;
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    if (nativeRuntime && (leavingInternalPage || !step.native)) {
      // The native page's own history never saw the internal page, or this
      // entry came from another device or an earlier session: load it.
      if (browserRuntimeCreated(tab)) {
        void invoke("browser_webview_navigate", {
          request: {
            id: browserRuntimeId(tab),
            url,
          },
        }).catch((error: unknown) => setBrowserError(tab.id, error));
      }
    } else if (nativeRuntime) {
      void invoke(direction < 0 ? "browser_webview_back" : "browser_webview_forward", {
        request: {
          id: browserRuntimeId(tab),
        },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
    }
    return true;
  };
  const focused = () => {
    const workspace = useWorkspaceStore.getState();
    const pane = dockLeaves(workspace.layout.root).find(
      (candidate) => candidate.id === workspace.layout.focusedPaneId,
    );
    return pane?.activeViewId === tab.id;
  };
  useShortcutHandler("browser.edit_address", onEditAddress, focused, 100);
  useShortcutHandler("navigation.back", () => travel(-1), focused, 100);
  useShortcutHandler("navigation.forward", () => travel(1), focused, 100);
  useShortcutHandler(
    "navigation.refresh",
    () => {
      if (!nativeRuntime) return false;
      useBrowserRuntimeStore.getState().setLoading(tab.id, true);
      void invoke("browser_webview_reload", {
        request: {
          id: browserRuntimeId(tab),
        },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
      return true;
    },
    focused,
    100,
  );
  const reload = () => {
    if (!nativeRuntime || internalPage) return;
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    void invoke("browser_webview_reload", {
      request: {
        id: browserRuntimeId(tab),
      },
    }).catch((error: unknown) => setBrowserError(tab.id, error));
  };
  return { navigateActiveTab, travel, reload, focused };
}

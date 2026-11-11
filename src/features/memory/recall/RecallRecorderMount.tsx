import { useEffect } from "react";
import { browserPageTools } from "@/features/browser";
import { browserRuntimeId } from "@/features/app-windows";
import { useSettingsStore } from "@/features/settings";
import { allLayoutPanes, parseBrowserViewState, useWorkspaceStore } from "@/features/app-windows";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { memoryApi } from "./api";
import { recallSettings } from "./recallSettings";
import { RecallRecorder, type ActivePage } from "./recorder/recorder";
import { useRecallStore } from "./useRecallStore";
import { windowSpaceId } from "./windowSpace";

/** The browser page in the focused pane of the focused window. */
function activePage(): ActivePage | null {
  const workspace = useWorkspaceStore.getState();
  const layout = workspace.layout;
  const pane = allLayoutPanes(layout).find((p) => p.id === layout.focusedPaneId);
  const view = pane?.views.find((v) => v.id === pane.activeViewId);
  if (!view || view.surfaceId !== "browser") return null;
  const state = parseBrowserViewState(view.state);
  if (!state.url) return null;
  return {
    runtimeId: browserRuntimeId(view),
    url: state.url,
    title: view.title ?? "",
    private: false,
    agentOwned: state.agentOwned,
    spaceId: windowSpaceId(),
  };
}

/** Every browser tab in the window, in front or not. */
function openTabs(): ActivePage[] {
  const layout = useWorkspaceStore.getState().layout;
  return allLayoutPanes(layout).flatMap((pane) =>
    pane.views.flatMap((view) => {
      if (view.surfaceId !== "browser") return [];
      const state = parseBrowserViewState(view.state);
      if (!state.url) return [];
      return [
        {
          runtimeId: browserRuntimeId(view),
          url: state.url,
          title: view.title ?? "",
          private: false,
          agentOwned: state.agentOwned,
          spaceId: windowSpaceId(),
        },
      ];
    }),
  );
}

/** Runs Memory's page recorder in the main window while Memory is on. */
export function RecallRecorderMount() {
  const enabled = hasTauriInternals();
  useEffect(() => {
    if (!enabled) return;
    const settings = () => recallSettings(useSettingsStore.getState().settings?.document);
    const recorder = new RecallRecorder({
      privacy: settings,
      readArticle: (id) => browserPageTools.readerArticle(id),
      record: (event) => memoryApi.record(event),
      attentive: () => document.visibilityState === "visible" && document.hasFocus(),
      onFull: (message) => useRecallStore.getState().setNotice(message),
    });
    const check = () => {
      const front = activePage();
      recorder.observe(front);
      recorder.observeTabs(openTabs(), front?.runtimeId);
    };
    check();
    const unsubscribe = useWorkspaceStore.subscribe(check);
    const unsubscribeSettings = useSettingsStore.subscribe(check);
    window.addEventListener("focus", check);
    return () => {
      unsubscribe();
      unsubscribeSettings();
      window.removeEventListener("focus", check);
      recorder.stop();
    };
  }, [enabled]);
  return null;
}

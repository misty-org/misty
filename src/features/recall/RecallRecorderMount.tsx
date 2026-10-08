import { useEffect } from "react";
import { browserPageTools, browserRuntimeId } from "@/features/browser";
import { publicBetaFeatureEnabled } from "@/features/launch";
import { useSettingsStore } from "@/features/settings";
import { allLayoutPanes, parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { memoryApi } from "./api";
import { recallSettings } from "./recallSettings";
import { RecallRecorder, type ActivePage } from "./recorder/recorder";
import { useRecallStore } from "./useRecallStore";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";

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
    private: isIncognitoWindow(),
    agentOwned: state.agentOwned,
  };
}

/** Runs Memory's page recorder in the main window while Memory is on. */
export function RecallRecorderMount() {
  const enabled = publicBetaFeatureEnabled("recall") && hasTauriInternals();
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
    const check = () => recorder.observe(activePage());
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

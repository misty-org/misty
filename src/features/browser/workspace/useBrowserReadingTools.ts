import { useShortcutHandler } from "@/features/shortcuts";
import { dockLeaves, useWorkspaceStore, type WorkspaceView } from "@/features/workspace";
import { useBrowserRuntimeStore } from "./browserRuntime";
import { translatePageWithMisty } from "./translatePage";
import { useReaderMode } from "./useReaderMode";

/** Reader view and Misty translation for a tab's live web page. */
export function useBrowserReadingTools(input: {
  tab: WorkspaceView;
  url: string;
  /** A native web page is showing. */
  available: boolean;
}) {
  const { tab, url, available } = input;
  // The page is the focused pane's view, as for the browser's other shortcuts.
  const focused = () => {
    const workspace = useWorkspaceStore.getState();
    const pane = dockLeaves(workspace.layout.root).find(
      (candidate) => candidate.id === workspace.layout.focusedPaneId,
    );
    return pane?.activeViewId === tab.id;
  };
  const reader = useReaderMode({ tab, url, available, focused });
  const translate = available
    ? () =>
        void translatePageWithMisty(tab, url).catch((error: unknown) =>
          useBrowserRuntimeStore
            .getState()
            .setError(tab.id, error instanceof Error ? error.message : String(error)),
        )
    : undefined;
  useShortcutHandler(
    "browser.translate",
    () => {
      if (!translate) return false;
      translate();
      return true;
    },
    focused,
    100,
  );
  return { reader, translate };
}

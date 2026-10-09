import {
  browserSearchUrl,
  dockLeaves,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { openPeek } from "@/features/workspace/peek";
import { browserRuntimeId } from "./browserRuntime";
import type { BrowserPageCommands } from "./useBrowserPageCommands";

/** Page commands the native context menu hands back to the browser that owns the page. */
interface BrowserMenuCommand {
  sourceId: string;
  command: string;
  url?: string;
  query?: string;
}

/**
 * Runs the page commands chosen from the browser's right-click menu. The native side
 * has already checked that the menu is current and the page has not changed.
 */
export function useBrowserMenuCommands(input: {
  tab: WorkspaceView;
  commands: BrowserPageCommands;
  travel: (direction: -1 | 1) => boolean;
  reload: () => void;
  annotate: () => void;
}) {
  const latest = useRef(input);
  latest.current = input;
  const runtimeId = browserRuntimeId(input.tab);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const stop = listen<BrowserMenuCommand>("misty://browser-menu-command", ({ payload }) => {
      if (payload.sourceId !== runtimeId) return;
      const { tab, commands, travel, reload, annotate } = latest.current;
      switch (payload.command) {
        case "back":
          travel(-1);
          break;
        case "forward":
          travel(1);
          break;
        case "reload":
          reload();
          break;
        case "bookmark":
          commands.bookmark?.();
          break;
        case "qr-code":
          commands.qrCode?.();
          break;
        case "annotate":
          annotate();
          break;
        case "open-link-split":
          if (payload.url) openInSplitView(tab, payload.url);
          break;
        case "peek-link": {
          const opened = payload.url ? openPeek(payload.url, tab.id) : null;
          if (opened)
            window.dispatchEvent(
              new CustomEvent("misty:focus-workspace-tab", { detail: { tabId: opened.id } }),
            );
          break;
        }
        case "search-web":
          if (payload.query) commands.openInNewTab(browserSearchUrl(payload.query));
          break;
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [runtimeId]);
}

function openInSplitView(source: WorkspaceView, url: string) {
  const workspace = useWorkspaceStore.getState();
  const pane = dockLeaves(workspace.layout.root).find((candidate) =>
    candidate.views.some((item) => item.id === source.id),
  );
  const opened = workspace.openBrowserView({ url, paneId: pane?.id, sourceViewId: source.id });
  // At the panel limit the link still opens, as a tab beside this one.
  if (pane) workspace.splitPane(pane.id, "right", opened.id);
}

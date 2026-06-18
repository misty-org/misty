import { useEffect } from "react";
import { MultiPanelWorkspace } from "../../shared/multipanel/MultiPanelWorkspace";
import { useAppStore } from "../../app/useAppStore";
import { ExplorerPane } from "./components/ExplorerPane";
import { ExplorerSidebar } from "./components/ExplorerSidebar";
import { ExplorerToolbar } from "./components/ExplorerToolbar";
import { FileInspector } from "./components/FileInspector";
import { selectedEntryForPane, useExplorerStore } from "./state/useExplorerStore";
import { useMultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";

export function ExplorerWorkspace() {
  const app = useAppStore((state) => state.app);
  const initialize = useExplorerStore((state) => state.initialize);
  const explorer = useExplorerStore();
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const homePath = app?.environment.homeDir ?? "/";
  const activePane = explorer.panes[activePaneId];
  const activePath = activePane?.listing?.path ?? homePath;
  const selectedEntry = selectedEntryForPane(activePane);

  useEffect(() => {
    if (app?.environment.homeDir) {
      void initialize(app.environment.homeDir);
    }
  }, [app?.environment.homeDir, initialize]);

  return (
    <section className="explorer-workspace">
      <ExplorerSidebar
        homePath={homePath}
        activePath={activePath}
        onNavigate={(path) => {
          if (activePaneId) void explorer.navigatePane(activePaneId, path);
        }}
      />
      <main className="explorer-main-shell">
        <MultiPanelWorkspace
          className="explorer-multipanel"
          renderToolbar={(paneId, path) => (
            <ExplorerToolbar
              path={explorer.panes[paneId]?.listing?.path ?? path}
              commandQuery={explorer.commandQuery}
              viewMode={explorer.viewMode}
              showHidden={explorer.showHidden}
              onNavigate={(nextPath) => void explorer.navigatePane(paneId, nextPath)}
              onParent={() => void explorer.navigateParent(paneId)}
              onRefresh={() => void explorer.refreshPane(paneId)}
              onCommandQuery={explorer.setCommandQuery}
              onViewMode={explorer.setViewMode}
              onToggleHidden={() => void explorer.toggleHidden()}
            />
          )}
          renderAside={<FileInspector listing={activePane?.listing ?? null} selectedEntry={selectedEntry} />}
          renderPane={(paneId, path) => <ExplorerPane paneId={paneId} path={path} />}
        />
      </main>
    </section>
  );
}

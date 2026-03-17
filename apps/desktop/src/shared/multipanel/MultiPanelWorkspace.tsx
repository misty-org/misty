import { Columns2, PanelTopClose, Rows2, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { activeMultiPanelTab, maxMultiPanelPanes, useMultiPanelStore } from "./useMultiPanelStore";

interface MultiPanelWorkspaceProps {
  className?: string;
  renderToolbar?: (paneId: string, path: string) => ReactNode;
  renderAside?: ReactNode;
  renderPane: (paneId: string, path: string) => ReactNode;
}

export function MultiPanelWorkspace(props: MultiPanelWorkspaceProps) {
  const {
    tabs,
    activeTabId,
    activePaneId,
    closedPanes,
    addTab,
    closeTab,
    selectTab,
    splitPane,
    closePane,
    restorePane,
    setActivePane,
  } = useMultiPanelStore();
  const activeTab = activeMultiPanelTab({ tabs, activeTabId });
  if (!activeTab) return null;
  const canSplit = activeTab.panes.length < maxMultiPanelPanes();

  return (
    <section className={`multi-workspace${props.renderToolbar ? " has-toolbar" : ""}${props.className ? ` ${props.className}` : ""}`}>
      <div className="multi-workspace-tabs">
        <div className="multi-tab-strip">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={`multi-tab ${tab.id === activeTabId ? "selected" : ""}`}
              onClick={() => selectTab(tab.id)}
            >
              <span>{tab.title}</span>
              {tabs.length > 1 ? (
                <X
                  size={14}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                />
              ) : null}
            </button>
          ))}
          <button type="button" className="multi-tab-add" onClick={() => addTab(activeTab.path, activeTab.title)}>
            +
          </button>
        </div>
        <div className="multi-pane-actions">
          <button type="button" title="Split vertically" onClick={() => splitPane(activePaneId, "vertical")} disabled={!canSplit}>
            <Columns2 size={16} />
          </button>
          <button type="button" title="Split horizontally" onClick={() => splitPane(activePaneId, "horizontal")} disabled={!canSplit}>
            <Rows2 size={16} />
          </button>
          <button type="button" title="Close pane" onClick={() => closePane(activePaneId)} disabled={activeTab.panes.length <= 1}>
            <PanelTopClose size={16} />
          </button>
          <button
            type="button"
            title="Restore pane"
            onClick={() => restorePane()}
            disabled={closedPanes.length === 0 || !canSplit}
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {props.renderToolbar ? props.renderToolbar(activeTab.activePaneId, activeTab.path) : null}

      <div className={`multi-workspace-body${props.renderAside ? " has-aside" : ""}`}>
        <div className={`multi-panel ${activeTab.layout.orientation} pane-count-${activeTab.layout.paneIds.length}`}>
          {activeTab.layout.paneIds.map((paneId) => {
            const pane = activeTab.panes.find((candidate) => candidate.id === paneId);
            if (!pane) return null;
            return (
              <div
                key={pane.id}
                className={`multi-pane ${activePaneId === pane.id ? "active" : ""}`}
                onMouseDown={() => setActivePane(pane.id)}
              >
                <div className="multi-pane-content">{props.renderPane(pane.id, pane.path)}</div>
              </div>
            );
          })}
        </div>
        {props.renderAside ? <aside className="multi-workspace-aside">{props.renderAside}</aside> : null}
      </div>
    </section>
  );
}

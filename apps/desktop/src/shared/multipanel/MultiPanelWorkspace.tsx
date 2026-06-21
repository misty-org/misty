import { Columns2, PanelTopClose, Rows2, RotateCcw, X } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { MultiPanelTab } from "./types";
import {
  activeMultiPanelTab,
  maxMultiPanelPanes,
  useMultiPanelStore,
  type MultiPanelStoreHook,
} from "./useMultiPanelStore";

interface MultiPanelWorkspaceProps {
  className?: string;
  store?: MultiPanelStoreHook;
  renderToolbar?: (paneId: string, path: string) => ReactNode;
  renderContextHeader?: (tab: MultiPanelTab) => ReactNode;
  renderAside?: ReactNode;
  onAsideResizeStart?: (event: PointerEvent<HTMLDivElement>) => void;
  canCloseTab?: (tab: MultiPanelTab) => boolean;
  onDidCloseTab?: (tab: MultiPanelTab) => void;
  canClosePane?: (paneId: string, tab: MultiPanelTab) => boolean;
  onDidClosePane?: (paneId: string, tab: MultiPanelTab) => void;
  renderPane: (paneId: string, path: string) => ReactNode;
}

export const MultiPanelWorkspace = memo(function MultiPanelWorkspace(props: MultiPanelWorkspaceProps) {
  const {
    canClosePane,
    canCloseTab,
    className,
    onAsideResizeStart,
    onDidClosePane,
    onDidCloseTab,
    renderAside,
    renderContextHeader,
    renderPane,
    renderToolbar,
    store: providedStore,
  } = props;
  const store = providedStore ?? useMultiPanelStore;
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
    setSplitRatio,
  } = store(useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activePaneId: state.activePaneId,
    closedPanes: state.closedPanes,
    addTab: state.addTab,
    closeTab: state.closeTab,
    selectTab: state.selectTab,
    splitPane: state.splitPane,
    closePane: state.closePane,
    restorePane: state.restorePane,
    setActivePane: state.setActivePane,
    setSplitRatio: state.setSplitRatio,
  })));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [draggingSplitter, setDraggingSplitter] = useState<"grid" | "lane0" | "lane1" | null>(null);
  const activeTab = activeMultiPanelTab({ tabs, activeTabId });
  const canSplit = Boolean(activeTab && activeTab.panes.length < maxMultiPanelPanes());
  const canRestore = Boolean(activeTab && canSplit && closedPanes.some((closedPane) => closedPane.tabId === activeTab.id));
  const lanes = activeTab ? normalizedLanes(activeTab) : [];
  const paneCount = lanes.flat().length;
  const gridSplitRatio = clampRatio(activeTab?.layout.gridSplitRatio ?? 0.5);
  const laneSplitRatios = activeTab?.layout.laneSplitRatios ?? [0.5, 0.5];
  const panelStyle = splitPanelStyle(lanes, gridSplitRatio);
  const handleCloseTab = useCallback((tab: MultiPanelTab) => {
    if (canCloseTab && !canCloseTab(tab)) return;
    closeTab(tab.id);
    onDidCloseTab?.(tab);
  }, [canCloseTab, closeTab, onDidCloseTab]);
  const handleClosePane = useCallback((paneId: string) => {
    if (!activeTab) return;
    if (canClosePane && !canClosePane(paneId, activeTab)) return;
    closePane(paneId);
    onDidClosePane?.(paneId, activeTab);
  }, [activeTab, canClosePane, closePane, onDidClosePane]);
  const beginSplitterDrag = useCallback((ratioKind: "grid" | "lane0" | "lane1", event: PointerEvent<HTMLDivElement>) => {
    if (!activeTab) return;
    event.preventDefault();
    event.stopPropagation();
    const container = ratioKind === "grid" ? panelRef.current : event.currentTarget.parentElement;
    if (!container) return;
    setDraggingSplitter(ratioKind);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = ratioKind === "grid" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    let frame: number | null = null;
    let pendingRatio = ratioFromPointer(container, ratioKind, event.clientX, event.clientY);
    const apply = () => {
      frame = null;
      setSplitRatio(activeTab.id, ratioKind, pendingRatio);
    };
    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      pendingRatio = ratioFromPointer(container, ratioKind, moveEvent.clientX, moveEvent.clientY);
      if (frame === null) frame = window.requestAnimationFrame(apply);
    };
    const finish = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      setSplitRatio(activeTab.id, ratioKind, pendingRatio);
      setDraggingSplitter(null);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish, { once: true });
  }, [activeTab, setSplitRatio]);

  if (!activeTab) return null;

  return (
    <section className={`multi-workspace${renderToolbar ? " has-toolbar" : ""}${className ? ` ${className}` : ""}`}>
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
                    handleCloseTab(tab);
                  }}
                />
              ) : null}
            </button>
          ))}
        </div>
        <div className="multi-tab-controls">
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
          <button type="button" title="Close pane" onClick={() => handleClosePane(activePaneId)} disabled={activeTab.panes.length <= 1}>
            <PanelTopClose size={16} />
          </button>
          <button
            type="button"
            title="Restore pane"
            onClick={() => restorePane()}
            disabled={!canRestore}
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {renderToolbar || renderContextHeader ? (
        <div className="multi-workspace-tools">
          {renderToolbar ? (
            <MultiPanelToolbarSlot renderToolbar={renderToolbar} paneId={activeTab.activePaneId} path={activeTab.path} />
          ) : null}
          {renderContextHeader ? (
            <MultiPanelContextHeaderSlot renderContextHeader={renderContextHeader} tab={activeTab} />
          ) : null}
        </div>
      ) : null}

      <div className={`multi-workspace-body${renderAside ? " has-aside" : ""}`}>
        <div
          ref={panelRef}
          className={`multi-panel lane-count-${lanes.length} pane-count-${paneCount}`}
          style={panelStyle}
        >
          {lanes.map((lane, laneIndex) => {
            const laneRatio = clampRatio(laneSplitRatios[laneIndex] ?? 0.5);
            return (
              <div
                key={`lane-${lane.join(":")}`}
                className={`multi-panel-lane pane-count-${lane.length}`}
                style={laneStyle(lane, laneRatio)}
              >
                {lane.map((paneId) => {
                  const pane = activeTab.panes.find((candidate) => candidate.id === paneId);
                  if (!pane) return null;
                  return (
                    <div
                      key={pane.id}
                      className={`multi-pane ${activePaneId === pane.id ? "active" : ""}`}
                      onMouseDown={() => {
                        if (activePaneId !== pane.id) setActivePane(pane.id);
                      }}
                    >
                      <div className="multi-pane-content">
                        <MultiPanelPaneSlot renderPane={renderPane} paneId={pane.id} path={pane.path} />
                      </div>
                    </div>
                  );
                })}
                {lane.length > 1 ? (
                  <div
                    className={`multi-panel-splitter horizontal${draggingSplitter === `lane${laneIndex}` ? " active" : ""}`}
                    style={{ top: `${laneRatio * 100}%` }}
                    onPointerDown={(event) => beginSplitterDrag(laneIndex === 0 ? "lane0" : "lane1", event)}
                    role="separator"
                    aria-orientation="horizontal"
                  />
                ) : null}
              </div>
            );
          })}
          {lanes.length > 1 ? (
            <div
              className={`multi-panel-splitter vertical${draggingSplitter === "grid" ? " active" : ""}`}
              style={{ left: `${gridSplitRatio * 100}%` }}
              onPointerDown={(event) => beginSplitterDrag("grid", event)}
              role="separator"
              aria-orientation="vertical"
            />
          ) : null}
        </div>
        {renderAside ? (
          <>
            <div className="multi-workspace-aside-resizer" onPointerDown={onAsideResizeStart} />
            <aside className="multi-workspace-aside">{renderAside}</aside>
          </>
        ) : null}
      </div>
    </section>
  );
});

function MultiPanelToolbarSlot(props: {
  renderToolbar: NonNullable<MultiPanelWorkspaceProps["renderToolbar"]>;
  paneId: string;
  path: string;
}) {
  return <>{props.renderToolbar(props.paneId, props.path)}</>;
}

function MultiPanelContextHeaderSlot(props: {
  renderContextHeader: NonNullable<MultiPanelWorkspaceProps["renderContextHeader"]>;
  tab: MultiPanelTab;
}) {
  return <>{props.renderContextHeader(props.tab)}</>;
}

function MultiPanelPaneSlot(props: {
  renderPane: MultiPanelWorkspaceProps["renderPane"];
  paneId: string;
  path: string;
}) {
  return <>{props.renderPane(props.paneId, props.path)}</>;
}

function splitPanelStyle(lanes: string[][], gridRatio: number): CSSProperties {
  if (lanes.length <= 1) return {};
  return {
    gridTemplateColumns: `${gridRatio}fr ${1 - gridRatio}fr`,
    gridTemplateRows: "minmax(0, 1fr)",
  };
}

function laneStyle(lane: string[], rowRatio: number): CSSProperties {
  if (lane.length <= 1) return {};
  return {
    gridTemplateRows: `${rowRatio}fr ${1 - rowRatio}fr`,
  };
}

function normalizedLanes(tab: MultiPanelTab): string[][] {
  if (tab.layout.lanes?.length) return tab.layout.lanes.map((lane) => lane.slice(0, 2)).filter((lane) => lane.length > 0).slice(0, 2);
  const ids = tab.layout.paneIds.slice(0, maxMultiPanelPanes());
  if (ids.length <= 1) return ids.length ? [[ids[0]]] : [];
  if (tab.layout.orientation === "horizontal") return [ids.slice(0, 2)];
  if (ids.length === 2) return [[ids[0]], [ids[1]]];
  return [ids.slice(0, 2), ids.slice(2, 4)];
}

function ratioFromPointer(
  panel: HTMLElement,
  ratioKind: "grid" | "lane0" | "lane1",
  clientX: number,
  clientY: number,
): number {
  const rect = panel.getBoundingClientRect();
  const raw = ratioKind === "grid"
    ? (clientX - rect.left) / Math.max(1, rect.width)
    : (clientY - rect.top) / Math.max(1, rect.height);
  return clampRatio(raw);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.9, Math.max(0.1, value));
}

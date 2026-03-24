import { Columns2, PanelTopClose, Rows2 } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChromeTabStrip } from "./ChromeTabStrip";
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
  renderBottomBar?: (tab: MultiPanelTab) => ReactNode;
  renderTabActions?: () => ReactNode;
  showDefaultPaneControls?: boolean;
  renderContextHeader?: (tab: MultiPanelTab) => ReactNode;
  renderNavigationAside?: ReactNode;
  onNavigationAsideResizeStart?: (event: PointerEvent<HTMLDivElement>) => void;
  renderAside?: ReactNode;
  onAsideResizeStart?: (event: PointerEvent<HTMLDivElement>) => void;
  canCloseTab?: (tab: MultiPanelTab) => boolean;
  onDidCloseTab?: (tab: MultiPanelTab) => void;
  canClosePane?: (paneId: string, tab: MultiPanelTab) => boolean;
  onDidClosePane?: (paneId: string, tab: MultiPanelTab) => void;
  renderPane: (paneId: string, path: string) => ReactNode;
}

const multiPanelStyles = {
  workspace:
    "grid h-full min-h-0 w-full min-w-0 overflow-hidden bg-[#0b0b0b] max-[720px]:bg-[#070707]",
  workspaceRows:
    "grid-rows-[46px_minmax(0,1fr)] max-[720px]:grid-rows-[38px_minmax(0,1fr)]",
  workspaceRowsWithBottom:
    "grid-rows-[46px_minmax(0,1fr)_auto] max-[720px]:grid-rows-[38px_minmax(0,1fr)_auto]",
  workspaceWithToolbar:
    "grid-rows-[46px_auto_minmax(0,1fr)] max-[720px]:grid-rows-[38px_auto_minmax(0,1fr)]",
  workspaceWithToolbarAndBottom:
    "grid-rows-[46px_auto_minmax(0,1fr)_auto] max-[720px]:grid-rows-[38px_auto_minmax(0,1fr)_auto]",
  tools: "relative z-[2] grid min-w-0 min-h-[92px]",
  body: "grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden",
  bodyWithNavigation:
    "grid-cols-[var(--explorer-sidebar-width,260px)_2px_minmax(0,1fr)] max-[980px]:grid-cols-[minmax(0,1fr)]",
  bodyWithAside:
    "grid-cols-[minmax(0,1fr)_2px_var(--preview-width,280px)] max-[980px]:grid-cols-[minmax(0,1fr)]",
  bodyWithNavigationAndAside:
    "grid-cols-[var(--explorer-sidebar-width,260px)_2px_minmax(0,1fr)_2px_var(--preview-width,280px)] max-[980px]:grid-cols-[minmax(0,1fr)]",
  panel:
    "relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-transparent [contain:layout_paint]",
  lane:
    "relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden",
  splitter:
    "absolute z-[6] bg-transparent after:absolute after:bg-transparent after:content-[''] hover:after:bg-[#888888]",
  splitterActive: "after:bg-[#888888]",
  splitterVertical:
    "bottom-0 top-0 w-[11px] -translate-x-[5px] cursor-col-resize after:bottom-0 after:left-[5px] after:top-0 after:w-px",
  splitterHorizontal:
    "left-0 right-0 h-[11px] -translate-y-[5px] cursor-row-resize after:left-0 after:right-0 after:top-[5px] after:h-px",
  aside:
    "min-h-0 min-w-0 overflow-hidden max-[980px]:hidden",
  asideResizer:
    "relative min-h-0 min-w-0 cursor-col-resize bg-transparent after:absolute after:bottom-0 after:left-1/2 after:top-0 after:w-px after:-translate-x-1/2 after:bg-[#222222] after:content-[''] hover:after:bg-[#3a3a3a] max-[980px]:hidden",
  navigationAside:
    "min-h-0 min-w-0 overflow-hidden max-[980px]:hidden",
  navigationAsideResizer:
    "relative min-h-0 min-w-0 cursor-col-resize bg-transparent after:absolute after:bottom-0 after:left-1/2 after:top-0 after:w-px after:-translate-x-1/2 after:bg-[#222222] after:content-[''] hover:after:bg-[#3a3a3a] max-[980px]:hidden",
  pane:
    "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-[#111111] [container-type:inline-size]",
  paneActive: "",
  paneContent: "min-h-0 min-w-0 overflow-hidden",
  paneActions:
    "flex flex-none items-center gap-1 overflow-hidden px-2 py-1 max-[720px]:gap-0.5 max-[720px]:px-1.5",
  paneActionButton:
    "grid h-[26px] w-7 place-items-center rounded-md border-0 bg-transparent text-[#adadad] hover:bg-[#1d1d1d] hover:text-[#eeeeee] max-[720px]:h-7 max-[720px]:w-[30px]",
} as const;

export const MultiPanelWorkspace = memo(function MultiPanelWorkspace(props: MultiPanelWorkspaceProps) {
  const {
    canClosePane,
    canCloseTab,
    className,
    onAsideResizeStart,
    onNavigationAsideResizeStart,
    onDidClosePane,
    onDidCloseTab,
    renderAside,
    renderBottomBar,
    renderContextHeader,
    renderNavigationAside,
    renderPane,
    renderTabActions,
    renderToolbar,
    showDefaultPaneControls = true,
    store: providedStore,
  } = props;
  const store = providedStore ?? useMultiPanelStore;
  const {
    tabs,
    activeTabId,
    activePaneId,
    addTab,
    closeTab,
    selectTab,
    splitPane,
    closePane,
    collapseDuplicateBrowsePanes,
    reorderTabs,
    setActivePane,
    setSplitRatio,
  } = store(useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activePaneId: state.activePaneId,
    addTab: state.addTab,
    closeTab: state.closeTab,
    selectTab: state.selectTab,
    splitPane: state.splitPane,
    closePane: state.closePane,
    collapseDuplicateBrowsePanes: state.collapseDuplicateBrowsePanes,
    reorderTabs: state.reorderTabs,
    setActivePane: state.setActivePane,
    setSplitRatio: state.setSplitRatio,
  })));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [draggingSplitter, setDraggingSplitter] = useState<"grid" | "lane0" | "lane1" | null>(null);
  const activeTab = activeMultiPanelTab({ tabs, activeTabId });
  const canSplit = Boolean(activeTab && activeTab.panes.length < maxMultiPanelPanes());
  const lanes = activeTab ? normalizedLanes(activeTab) : [];
  const paneCount = lanes.flat().length;
  const gridSplitRatio = clampRatio(activeTab?.layout.gridSplitRatio ?? 0.5);
  const laneSplitRatios = activeTab?.layout.laneSplitRatios ?? [0.5, 0.5];
  const panelStyle = splitPanelStyle(lanes, gridSplitRatio);
  const didCleanRestoredBrowsePanesRef = useRef(false);
  useEffect(() => {
    if (didCleanRestoredBrowsePanesRef.current) return;
    didCleanRestoredBrowsePanesRef.current = true;
    collapseDuplicateBrowsePanes();
  }, [collapseDuplicateBrowsePanes]);
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
  const hasNavigationAside = Boolean(renderNavigationAside);
  const hasAside = Boolean(renderAside);
  const bodyClassName = cx(
    multiPanelStyles.body,
    hasNavigationAside && hasAside && multiPanelStyles.bodyWithNavigationAndAside,
    hasNavigationAside && !hasAside && multiPanelStyles.bodyWithNavigation,
    !hasNavigationAside && hasAside && multiPanelStyles.bodyWithAside,
  );
  const toolbarContent = renderToolbar ? renderToolbar(activeTab.activePaneId, activeTab.path) : null;
  const contextHeaderContent = renderContextHeader ? renderContextHeader(activeTab) : null;
  const bottomBarContent = renderBottomBar ? renderBottomBar(activeTab) : null;
  const hasTools = Boolean(toolbarContent || contextHeaderContent);
  const hasBottomBar = Boolean(bottomBarContent);
  const workspaceRowsClass = hasTools
    ? (hasBottomBar ? multiPanelStyles.workspaceWithToolbarAndBottom : multiPanelStyles.workspaceWithToolbar)
    : (hasBottomBar ? multiPanelStyles.workspaceRowsWithBottom : multiPanelStyles.workspaceRows);
  const tabStripActions = renderTabActions || showDefaultPaneControls ? (
    <div className={multiPanelStyles.paneActions}>
      {renderTabActions ? <MultiPanelTabActionsSlot renderTabActions={renderTabActions} /> : null}
      {showDefaultPaneControls ? (
        <>
          <button className={multiPanelStyles.paneActionButton} type="button" title="Split vertically" onClick={() => splitPane(activePaneId, "vertical")} disabled={!canSplit}>
            <Columns2 size={16} />
          </button>
          <button className={multiPanelStyles.paneActionButton} type="button" title="Split horizontally" onClick={() => splitPane(activePaneId, "horizontal")} disabled={!canSplit}>
            <Rows2 size={16} />
          </button>
          <button className={multiPanelStyles.paneActionButton} type="button" title="Close pane" onClick={() => handleClosePane(activePaneId)} disabled={activeTab.panes.length <= 1}>
            <PanelTopClose size={16} />
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <section className={`${multiPanelStyles.workspace} ${workspaceRowsClass}${className ? ` ${className}` : ""}`}>
      <ChromeTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        canCloseTab={() => tabs.length > 1}
        onSelectTab={selectTab}
        onCloseTab={(tab) => {
          const matchingTab = tabs.find((candidate) => candidate.id === tab.id);
          if (matchingTab) handleCloseTab(matchingTab);
        }}
        onReorderTab={reorderTabs}
        onAddTab={() => addTab(activeTab.path, activeTab.title)}
        actions={tabStripActions}
      />

      {hasTools ? (
        <div className={multiPanelStyles.tools}>
          {toolbarContent}
          {contextHeaderContent}
        </div>
      ) : null}

      <div className={bodyClassName}>
        {renderNavigationAside ? (
          <>
            <div className={multiPanelStyles.navigationAside}>{renderNavigationAside}</div>
            <div className={multiPanelStyles.navigationAsideResizer} onPointerDown={onNavigationAsideResizeStart} />
          </>
        ) : null}
        <div
          ref={panelRef}
          className={multiPanelStyles.panel}
          style={panelStyle}
        >
          {lanes.map((lane, laneIndex) => {
            const laneRatio = clampRatio(laneSplitRatios[laneIndex] ?? 0.5);
            return (
              <div
                key={`lane-${lane.join(":")}`}
                className={multiPanelStyles.lane}
                style={laneStyle(lane, laneRatio)}
              >
                {lane.map((paneId) => {
                  const pane = activeTab.panes.find((candidate) => candidate.id === paneId);
                  if (!pane) return null;
                  return (
                    <div
                      key={pane.id}
                      className={`${multiPanelStyles.pane} ${activePaneId === pane.id ? multiPanelStyles.paneActive : ""}`}
                      onMouseDown={() => {
                        if (activePaneId !== pane.id) setActivePane(pane.id);
                      }}
                    >
                      <div className={multiPanelStyles.paneContent}>
                        <MultiPanelPaneSlot renderPane={renderPane} paneId={pane.id} path={pane.path} />
                      </div>
                    </div>
                  );
                })}
                {lane.length > 1 ? (
                  <div
                    className={`${multiPanelStyles.splitter} ${multiPanelStyles.splitterHorizontal} ${draggingSplitter === `lane${laneIndex}` ? multiPanelStyles.splitterActive : ""}`}
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
              className={`${multiPanelStyles.splitter} ${multiPanelStyles.splitterVertical} ${draggingSplitter === "grid" ? multiPanelStyles.splitterActive : ""}`}
              style={{ left: `${gridSplitRatio * 100}%` }}
              onPointerDown={(event) => beginSplitterDrag("grid", event)}
              role="separator"
              aria-orientation="vertical"
            />
          ) : null}
        </div>
        {renderAside ? (
          <>
            <div className={multiPanelStyles.asideResizer} onPointerDown={onAsideResizeStart} />
            <aside className={multiPanelStyles.aside}>{renderAside}</aside>
          </>
        ) : null}
      </div>
      {bottomBarContent}
    </section>
  );
});

function MultiPanelTabActionsSlot(props: {
  renderTabActions: NonNullable<MultiPanelWorkspaceProps["renderTabActions"]>;
}) {
  return <>{props.renderTabActions()}</>;
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

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

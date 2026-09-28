import { GripVertical } from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import type { ComponentType } from "react";
import type { ChromeTabStripProps } from "./model/interfaces";
import type { MultiPanelTab, MultiPanelWorkspaceProps } from "./model/interfaces";
import { sidePanelGridStyle } from "./sidePanelGridStyle";
import { activeMultiPanelTab, useMultiPanelStore } from "./useMultiPanelStore";
import type { MultiPanelStoreHook } from "./model/types/useMultiPanelStore";
export type { MultiPanelWorkspaceProps } from "./model/interfaces";

const MultiPanelStoreContext = createContext<MultiPanelStoreHook | null>(null);

export function useMultiPanelStoreContext(): MultiPanelStoreHook | null {
  return useContext(MultiPanelStoreContext);
}

// Shared pane edges are owned here so adjacent panels never draw duplicate borders.
const paneResizeDividerClass = [
  "group/resize relative z-[5] min-h-0 min-w-0 cursor-col-resize bg-transparent before:absolute before:inset-y-0",
  "before:inset-x-0 before:mx-auto before:w-[9px] before:content-[''] after:pointer-events-none after:absolute",
  "after:inset-0 after:mx-auto after:w-px after:bg-charcoal-border",
  "after:content-[''] hover:after:bg-charcoal-active focus-visible:outline-none focus-visible:after:bg-cream-muted",
].join(" ");
const paneResizeDividerActiveClass = "after:!bg-charcoal-active [&>div]:!opacity-100";

const multiPanelStyles = {
  workspace: "grid h-full min-h-0 w-full min-w-0 overflow-hidden bg-charcoal-sidebar",
  workspaceRows: "grid-rows-[46px_minmax(0,1fr)] max-[720px]:grid-rows-[38px_minmax(0,1fr)]",
  workspaceRowsWithBottom:
    "grid-rows-[46px_minmax(0,1fr)_auto] max-[720px]:grid-rows-[38px_minmax(0,1fr)_auto]",
  workspaceWithToolbar:
    "grid-rows-[46px_auto_minmax(0,1fr)] max-[720px]:grid-rows-[38px_auto_minmax(0,1fr)]",
  workspaceWithToolbarAndBottom:
    "grid-rows-[46px_auto_minmax(0,1fr)_auto] max-[720px]:grid-rows-[38px_auto_minmax(0,1fr)_auto]",
  workspaceRowsWithoutTabs: "grid-rows-[minmax(0,1fr)]",
  workspaceRowsWithBottomWithoutTabs: "grid-rows-[minmax(0,1fr)_auto]",
  workspaceWithToolbarWithoutTabs: "grid-rows-[auto_minmax(0,1fr)]",
  workspaceWithToolbarAndBottomWithoutTabs: "grid-rows-[auto_minmax(0,1fr)_auto]",
  tools:
    "relative z-[2] grid min-h-[92px] min-w-0 border-b border-charcoal-border/60 bg-charcoal-sidebar",
  body: "grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden",
  panel: [
    "relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden",
    "bg-charcoal-bg [contain:layout_paint]",
  ].join(" "),
  aside: "min-h-0 min-w-0 overflow-hidden bg-charcoal-sidebar",
  asideResizer: paneResizeDividerClass,
  asideResizerActive: paneResizeDividerActiveClass,
  navigationAside: "min-h-0 min-w-0 overflow-hidden bg-charcoal-sidebar",
  navigationAsideResizer: paneResizeDividerClass,
  asideResizerGrip: [
    "pointer-events-none absolute inset-0 z-[1] m-auto grid size-5",
    "place-items-center rounded-md bg-charcoal-card text-cream-muted",
    "opacity-0 transition-opacity group-hover/resize:opacity-60",
  ].join(" "),
  asideResizerGripIcon: "pointer-events-none",
  pane: [
    "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-transparent outline-none",
    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cream-muted/50",
    "[container-type:inline-size]",
  ].join(" "),
  paneActive: "",
  paneContent: "min-h-0 min-w-0 overflow-hidden",
} as const;

export const MultiPanelWorkspaceView = memo(function MultiPanelWorkspaceView(
  props: MultiPanelWorkspaceProps & { TabStrip?: ComponentType<ChromeTabStripProps> },
) {
  const {
    TabStrip: ChromeTabStrip,
    canCloseTab,
    className,
    asideResizing = false,
    navigationAsideResizing = false,
    onAsideResizeStart,
    onAsideResizeBy,
    onNavigationAsideResizeStart,
    onNavigationAsideResizeBy,
    onDidCloseTab,
    renderAddTabControl,
    renderAside,
    asideWidth = 280,
    renderBottomBar,
    renderContextHeader,
    renderNavigationAside,
    navigationAsideWidth = 260,
    renderPane,
    registerTabDropTarget,
    renderTabActions,
    renderToolbar,
    showTabStrip = true,
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
    reorderTabs,
    setActivePane,
  } = store(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      activePaneId: state.activePaneId,
      addTab: state.addTab,
      closeTab: state.closeTab,
      selectTab: state.selectTab,
      reorderTabs: state.reorderTabs,
      setActivePane: state.setActivePane,
    })),
  );
  const workspaceElementRef = useRef<HTMLElement | null>(null);
  const [compactSidePanels, setCompactSidePanels] = useState(false);
  const activeTab = activeMultiPanelTab({ tabs, activeTabId });
  useLayoutEffect(() => {
    const element = workspaceElementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setCompactSidePanels(width <= 980);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sideResizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => sideResizeCleanup.current?.(), []);
  const beginSidePanelResize = (
    event: PointerEvent<HTMLDivElement>,
    resizeBy: ((delta: number) => void) | undefined,
    direction: number,
  ) => {
    if (!resizeBy || event.button !== 0) return;
    event.preventDefault();
    sideResizeCleanup.current?.();
    let previousX = event.clientX;
    const onMove = (move: globalThis.PointerEvent) => {
      const delta = (move.clientX - previousX) * direction;
      previousX = move.clientX;
      if (delta) resizeBy(delta);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      sideResizeCleanup.current = null;
    };
    sideResizeCleanup.current = finish;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };
  const handleCloseTab = useCallback(
    (tab: MultiPanelTab) => {
      if (canCloseTab && !canCloseTab(tab)) return;
      closeTab(tab.id);
      onDidCloseTab?.(tab);
    },
    [canCloseTab, closeTab, onDidCloseTab],
  );
  if (!activeTab) return null;
  // A split pane can be narrow even when the application window is wide.
  // Adapt side panels to this workspace's real container, not the viewport.
  const hasNavigationAside = Boolean(renderNavigationAside);
  const hasAside = Boolean(renderAside);
  const bodyClassName = multiPanelStyles.body;
  const bodyStyle = sidePanelGridStyle({
    asideWidth,
    compact: compactSidePanels,
    hasAside,
    hasNavigationAside,
    navigationAsideWidth,
  });
  const toolbarContent = renderToolbar
    ? renderToolbar(activeTab.activePaneId, activeTab.path)
    : null;
  const contextHeaderContent = renderContextHeader ? renderContextHeader(activeTab) : null;
  const bottomBarContent = renderBottomBar ? renderBottomBar(activeTab) : null;
  const hasTools = Boolean(toolbarContent || contextHeaderContent);
  const hasBottomBar = Boolean(bottomBarContent);
  const workspaceRowsClass = showTabStrip
    ? hasTools
      ? hasBottomBar
        ? multiPanelStyles.workspaceWithToolbarAndBottom
        : multiPanelStyles.workspaceWithToolbar
      : hasBottomBar
        ? multiPanelStyles.workspaceRowsWithBottom
        : multiPanelStyles.workspaceRows
    : hasTools
      ? hasBottomBar
        ? multiPanelStyles.workspaceWithToolbarAndBottomWithoutTabs
        : multiPanelStyles.workspaceWithToolbarWithoutTabs
      : hasBottomBar
        ? multiPanelStyles.workspaceRowsWithBottomWithoutTabs
        : multiPanelStyles.workspaceRowsWithoutTabs;
  const tabStripActions = renderTabActions ? (
    <MultiPanelTabActionsSlot renderTabActions={renderTabActions} />
  ) : null;
  const addTabControl = renderAddTabControl?.(activeTab, addTab);
  const livePanes = activeTab.panes
    .filter((pane) => pane.id === activeTab.activePaneId)
    .map((pane) => ({
      id: pane.id,
      content: (
        <div
          className={`${multiPanelStyles.pane} h-full ${activePaneId === pane.id ? multiPanelStyles.paneActive : ""}`}
          role="region"
          aria-label={`${pane.title} file pane`}
          data-multi-panel-pane={pane.id}
          tabIndex={0}
          onFocusCapture={() => {
            if (activePaneId !== pane.id) setActivePane(pane.id);
          }}
          onPointerDown={() => {
            if (activePaneId !== pane.id) setActivePane(pane.id);
          }}
        >
          <div className={multiPanelStyles.paneContent}>
            <MultiPanelPaneSlot renderPane={renderPane} paneId={pane.id} path={pane.path} />
          </div>
        </div>
      ),
    }));

  return (
    <MultiPanelStoreContext.Provider value={store}>
      <section
        ref={workspaceElementRef}
        className={`${multiPanelStyles.workspace} ${workspaceRowsClass}${className ? ` ${className}` : ""}`}
      >
        {showTabStrip && ChromeTabStrip ? (
          <ChromeTabStrip
            tabs={tabs.map((tab) => ({
              id: tab.id,
              namingId: tab.namingId,
              title: tab.title,
              path: tab.path,
              paneId: tab.activePaneId,
            }))}
            activeTabId={activeTabId}
            canCloseTab={(tab) => {
              const matchingTab = tabs.find((candidate) => candidate.id === tab.id);
              return Boolean(
                tabs.length > 1 && matchingTab && (!canCloseTab || canCloseTab(matchingTab)),
              );
            }}
            onSelectTab={selectTab}
            onCloseTab={(tab) => {
              const matchingTab = tabs.find((candidate) => candidate.id === tab.id);
              if (matchingTab) handleCloseTab(matchingTab);
            }}
            onReorderTab={reorderTabs}
            registerTabDropTarget={registerTabDropTarget}
            onAddTab={() => addTab(activeTab.path, activeTab.title)}
            addTabControl={addTabControl}
            actions={tabStripActions}
          />
        ) : null}

        {hasTools ? (
          <div className={multiPanelStyles.tools}>
            {toolbarContent}
            {contextHeaderContent}
          </div>
        ) : null}

        <div className={bodyClassName} style={bodyStyle}>
          {hasNavigationAside ? (
            <>
              <div className={multiPanelStyles.navigationAside}>{renderNavigationAside}</div>
              <div
                className={`${multiPanelStyles.navigationAsideResizer} ${navigationAsideResizing ? multiPanelStyles.asideResizerActive : ""}`}
                role="separator"
                aria-label="Resize file explorer sidebar"
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={
                  onNavigationAsideResizeStart ??
                  ((event) => beginSidePanelResize(event, onNavigationAsideResizeBy, 1))
                }
                onKeyDown={(event) => resizeSidePanelFromKeyboard(event, onNavigationAsideResizeBy)}
              >
                <div className={multiPanelStyles.asideResizerGrip}>
                  <GripVertical
                    className={multiPanelStyles.asideResizerGripIcon}
                    size={18}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </>
          ) : null}
          <div className={multiPanelStyles.panel}>
            {livePanes.map((pane) => (
              <div key={pane.id} className="min-h-0 min-w-0">
                {pane.content}
              </div>
            ))}
          </div>
          {hasAside ? (
            <>
              <div
                className={`${multiPanelStyles.asideResizer} ${asideResizing ? multiPanelStyles.asideResizerActive : ""}`}
                role="separator"
                aria-label="Resize preview panel"
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={
                  onAsideResizeStart ??
                  ((event) => beginSidePanelResize(event, onAsideResizeBy, -1))
                }
                onKeyDown={(event) => resizeSidePanelFromKeyboard(event, onAsideResizeBy)}
              >
                <div className={multiPanelStyles.asideResizerGrip}>
                  <GripVertical
                    className={multiPanelStyles.asideResizerGripIcon}
                    size={18}
                    aria-hidden="true"
                  />
                </div>
              </div>
              <aside className={multiPanelStyles.aside}>{renderAside}</aside>
            </>
          ) : null}
        </div>
        {bottomBarContent}
      </section>
    </MultiPanelStoreContext.Provider>
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

function resizeSidePanelFromKeyboard(
  event: KeyboardEvent<HTMLElement>,
  resize: ((delta: number) => void) | undefined,
): void {
  if (!resize || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  resize(event.key === "ArrowLeft" ? -16 : 16);
}

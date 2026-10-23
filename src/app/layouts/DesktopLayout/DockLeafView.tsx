import { DockDropPreview } from "./DockDropPreview";
import { useWorkspacePagePreview } from "@/features/workspace/useWorkspacePagePreview";
import { panePlacement } from "@/features/workspace/panePlacement";
import { keepsLayoutWhileHidden } from "./keptTabs";
import { selectPaneFocusPreferences } from "@/features/workspace/paneFocus";
import { browserRuntimeId } from "@/features/webviews/browserRuntime";
import { useBrowserPaneDim } from "@/features/webviews/useBrowserPaneDim";
import { useSettingsStore } from "@/features/settings";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { usePointerDropTarget } from "@/shared/hooks/usePointerReorder";
import {
  dockLeaves,
  useWorkspaceStore,
  WorkspaceViewTitleProvider,
  type DockDropZone,
  type WorkspacePane,
  type WorkspaceView,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import { memo, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { EmptyWorkspacePane, WorkspaceSurface } from "./WorkspaceSurface";
import { AiPaneHost } from "@/features/ai-surface/AiPaneHost";
import { dockSplitFits, dropZoneAt } from "./dockSplitFit";
import { workspaceAiAdapter } from "./workspaceAi";
import type { WorkspaceDockTreeProps } from "./WorkspaceDockTree";

const viewDragType = "application/x-misty-workspace-tab";

/**
 * One open tab's page. Every open tab stays mounted, so this is the render
 * boundary: store updates keep an untouched tab's object identical, and a
 * change to another tab, the layout or the app route leaves this page alone.
 */
const MountedWorkspaceView = memo(
  function MountedWorkspaceView(props: { paneId: string; tab: WorkspaceView; active: boolean }) {
    const tab = useRenderedView(props.tab);
    const defaultAdapter = useMemo(() => workspaceAiAdapter(tab), [tab]);
    // Showing or hiding the tab only tells the AI host; the page itself does not render again.
    const surface = useMemo(
      () => (
        <WorkspaceViewTitleProvider tabId={tab.id}>
          <WorkspaceSurface tab={tab} />
        </WorkspaceViewTitleProvider>
      ),
      [tab],
    );
    return (
      <AiPaneHost paneId={props.paneId} defaultAdapter={defaultAdapter} active={props.active}>
        {surface}
      </AiPaneHost>
    );
  },
  (previous, next) =>
    previous.paneId === next.paneId &&
    previous.active === next.active &&
    sameRenderedView(previous.tab, next.tab),
);

/**
 * Selecting a tab stamps it with `lastFocusedAt`, which only the store's own ordering reads. A
 * page handed that new object rendered again in full on every switch (a Space with a long
 * collection took a third of a second), so the page keeps the object it has until something
 * it shows changes.
 */
function sameRenderedView(previous: WorkspaceView, next: WorkspaceView): boolean {
  if (previous === next) return true;
  const keys = Object.keys(next) as (keyof WorkspaceView)[];
  if (keys.length !== Object.keys(previous).length) return false;
  return keys.every((key) => key === "lastFocusedAt" || previous[key] === next[key]);
}

function useRenderedView(view: WorkspaceView): WorkspaceView {
  const rendered = useRef(view);
  if (!sameRenderedView(rendered.current, view)) rendered.current = view;
  return rendered.current;
}

export function DockLeafView(props: WorkspaceDockTreeProps & { pane: WorkspacePane }) {
  const { pane } = props;
  const sectionRef = useRef<HTMLElement | null>(null);
  const [dropZone, setDropZone] = useState<DockDropZone | null>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const activeTab = pane.views.find((tab) => tab.id === pane.activeViewId) ?? pane.views[0];
  useWorkspacePagePreview(activeTab, sectionRef, props.workspaceActive !== false);
  const focused = props.workspaceActive !== false && pane.id === props.focusedPaneId;
  // Open tabs own live UI state and subscriptions. Hiding an inactive surface
  // must not unmount it, otherwise collaborative tools reconnect and reload on
  // every tab switch. Closing the tab remains the lifecycle boundary.
  const mountedTabs = [...pane.views].sort((a, b) => a.id.localeCompare(b.id));
  usePointerDropTarget(sectionRef, {
    scope: "workspace-tabs",
    hit(x, y, drag) {
      if (!sectionRef.current) return null;
      const rect = sectionRef.current.getBoundingClientRect(),
        zone = dropZoneAt(rect, x, y);
      const moving = allLayoutViews(useWorkspaceStore.getState().layout).find(
        (tab) => tab.id === drag.id,
      );
      if (!moving || (zone !== "center" && !dockSplitFits(pane, paneSize, zone, moving)))
        return null;
      const horizontal = zone === "left" || zone === "right";
      return {
        id: zone,
        after: zone === "right" || zone === "down",
        rect,
        axis: horizontal ? "x" : "y",
      };
    },
    drop: (drag, hit) => {
      useWorkspaceStore
        .getState()
        .dockViews(drag.ids ?? [drag.id], pane.id, hit.id as DockDropZone);
    },
  });

  usePointerDropTarget(sectionRef, {
    scope: "workspace-panes",
    hit(x, y, drag) {
      if (!sectionRef.current) return null;
      const rect = sectionRef.current.getBoundingClientRect();

      const root = useWorkspaceStore.getState().layout.root;
      const leafRects = dockLeaves(root)
        .map((leaf) =>
          document
            .querySelector<HTMLElement>(`[data-workspace-pane="${CSS.escape(leaf.id)}"]`)
            ?.getBoundingClientRect(),
        )
        .filter((value): value is DOMRect => Boolean(value));
      const left = Math.min(...leafRects.map((value) => value.left));
      const top = Math.min(...leafRects.map((value) => value.top));
      const placement = panePlacement(root, drag.id, x, y, {
        x: left,
        y: top,
        width: Math.max(...leafRects.map((value) => value.right)) - left,
        height: Math.max(...leafRects.map((value) => value.bottom)) - top,
      });
      if (!placement) return null;
      const projected = placement.bounds;
      const previewRect = new DOMRect(projected.x, projected.y, projected.width, projected.height);
      return {
        previewRect,
        id: JSON.stringify([placement.target, placement.zone]),
        after: placement.zone === "right" || placement.zone === "down",
        rect,
        axis: placement.zone === "left" || placement.zone === "right" ? "x" : "y",
      };
    },
    drop(drag, hit) {
      const store = useWorkspaceStore.getState();
      const [target, zone] = JSON.parse(hit.id) as [string, DockDropZone];
      if (zone === "center") store.swapPanes(drag.id, target);
      else store.movePane(drag.id, zone, target || undefined);
    },
  });

  const settingsDocument = useSettingsStore((state) => state.settings?.document);
  const focusPreferences = selectPaneFocusPreferences(settingsDocument);
  const multiPane = dockLeaves(useWorkspaceStore.getState().layout.root).length > 1;
  const dim =
    props.workspaceActive !== false && multiPane && !focused && focusPreferences.dim
      ? focusPreferences.strength
      : 0;
  // A browser page draws above the pane, so the host dims it natively.
  const activeView = pane.views.find((view) => view.id === pane.activeViewId);
  useBrowserPaneDim(activeView?.surfaceId === "browser" ? browserRuntimeId(activeView) : null, dim);
  useEffect(() => {
    const element = sectionRef.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setPaneSize((current) =>
        current.width === bounds.width && current.height === bounds.height
          ? current
          : { width: bounds.width, height: bounds.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(viewDragType)) return;
    event.preventDefault();
    const zone = dropZoneAt(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const movingTabId = event.dataTransfer.getData(viewDragType);
    const movingTab = allLayoutViews(useWorkspaceStore.getState().layout).find(
      (tab) => tab.id === movingTabId,
    );
    if (zone !== "center" && (!movingTab || !dockSplitFits(pane, paneSize, zone, movingTab))) {
      event.dataTransfer.dropEffect = "none";
      setDropZone(null);
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDropZone(zone);
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const tabId = event.dataTransfer.getData(viewDragType);
    const zone = dropZone ?? "center";
    setDropZone(null);
    if (!tabId) return;
    const movingTab = allLayoutViews(useWorkspaceStore.getState().layout).find(
      (tab) => tab.id === tabId,
    );
    if (zone !== "center" && (!movingTab || !dockSplitFits(pane, paneSize, zone, movingTab)))
      return;
    props.onDockView(tabId, pane.id, zone);
  };

  return (
    <section
      ref={sectionRef}
      className={cn(
        "group/pane relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]",
        "overflow-hidden bg-charcoal-bg focus:outline-none",
      )}
      data-workspace-pane={pane.id}
      data-browser-corner-clip=""
      onDragOver={dragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropZone(null);
      }}
      onDrop={drop}
      tabIndex={0}
      aria-label={activeTab ? `${activeTab.title} workspace pane` : "Empty workspace pane"}
      onFocus={() => useWorkspaceStore.getState().focusPane(pane.id)}
      onPointerDown={() => {
        if (!activeTab) {
          useWorkspaceStore.getState().focusPane(pane.id);
          return;
        }
        if (!focused) props.onOpen(activeTab);
        else useWorkspaceStore.getState().focusView(activeTab.id);
      }}
    >
      <header
        data-workspace-titlebar-fallback
        data-misty-window-titlebar-region="true"
        className="min-w-0 bg-charcoal-workspace text-xs text-cream-muted"
      >
        <span className="truncate">{activeTab?.title || "New tab"}</span>
      </header>
      <div
        className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden"
        data-pane-layer
      >
        {activeTab ? (
          mountedTabs.map((mountedTab) => {
            const isActive = props.workspaceActive !== false && mountedTab.id === activeTab.id;
            const kept = !isActive && keepsLayoutWhileHidden(mountedTab);
            return (
              <div
                key={mountedTab.id}
                className={cn(
                  "relative col-start-1 row-start-1 h-full min-h-0 w-full",
                  isActive ? "z-[1] block" : kept ? "z-0 block" : "hidden",
                )}
                aria-hidden={!isActive}
                data-tab-kept={kept ? "" : undefined}
              >
                <MountedWorkspaceView paneId={pane.id} tab={mountedTab} active={isActive} />
              </div>
            );
          })
        ) : (
          <EmptyWorkspacePane />
        )}
      </div>
      {dim > 0 ? (
        <div
          data-pane-dim
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 bg-black"
          style={{ opacity: dim }}
        />
      ) : null}
      {dropZone ? <DockDropPreview zone={dropZone} /> : null}
    </section>
  );
}

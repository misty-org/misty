import { DockDropPreview } from "./DockDropPreview";
import { panePlacement } from "@/features/app-windows";
import { keepsLayoutWhileHidden } from "./kept_tabs";
import { selectPaneFocusPreferences } from "@/features/app-windows";
import { useSettingsStore } from "@/features/settings";
import { allLayoutViews, dockWidgetRegistry } from "@/features/app-windows";
import { usePointerDropTarget } from "@misty/ui";
import {
  dockLeaves,
  useWorkspaceStore,
  WorkspaceViewTitleProvider,
  type DockDropZone,
  type WorkspacePane,
  type WorkspaceView,
} from "@/features/app-windows";
import { cn, Surface, Text } from "@misty/ui";
import { memo, useMemo, useRef, useState, type DragEvent } from "react";
import { EmptyWorkspacePane, WorkspaceSurface } from "./WorkspaceSurface";
import { AiPaneHost } from "@/features/agents";
import {
  dockRouteFits,
  dockSplitFits,
  dropZoneAt,
  dropZoneLabels,
  dropZoneRect,
} from "./dock_split_fit";
import { openWorkspaceRouteAt } from "./space_navigation";
import { workspaceAiAdapter } from "./workspace_ai";
import type { WorkspaceDockTreeProps } from "./WorkspaceDockTree";

const viewDragType = "application/x-misty-workspace-tab";

const MountedWorkspaceView = memo(
  function MountedWorkspaceView(props: { paneId: string; tab: WorkspaceView; active: boolean }) {
    const tab = useRenderedView(props.tab);
    const defaultAdapter = useMemo(() => workspaceAiAdapter(tab), [tab]);
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

function dockHit(rect: DOMRect, zone: DockDropZone) {
  return {
    id: zone,
    after: zone === "right" || zone === "down",
    rect,
    previewRect: dropZoneRect(rect, zone),
    box: true,
    label: dropZoneLabels[zone],
    axis: (zone === "left" || zone === "right" ? "x" : "y") as "x" | "y",
  };
}

export function DockLeafView(props: WorkspaceDockTreeProps & { pane: WorkspacePane }) {
  const { pane } = props;
  const sectionRef = useRef<HTMLElement | null>(null);
  const [dropZone, setDropZone] = useState<DockDropZone | null>(null);
  const paneSize = () => {
    const bounds = sectionRef.current?.getBoundingClientRect();
    return { width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
  };
  const activeTab = pane.views.find((tab) => tab.id === pane.activeViewId) ?? pane.views[0];
  const focused = props.workspaceActive !== false && pane.id === props.focusedPaneId;
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
      if (!moving || pane.views.some((view) => view.id === moving.id)) return null;
      if (zone !== "center" && !dockSplitFits(pane, paneSize(), zone, moving)) return null;
      return dockHit(rect, zone);
    },
    drop: (drag, hit) => {
      useWorkspaceStore
        .getState()
        .dockViews(drag.ids ?? [drag.id], pane.id, hit.id as DockDropZone);
    },
  });

  usePointerDropTarget(sectionRef, {
    scope: "workspace-place",
    hit(x, y, drag) {
      if (!sectionRef.current) return null;
      const rect = sectionRef.current.getBoundingClientRect(),
        zone = dropZoneAt(rect, x, y);
      if (zone !== "center" && !dockRouteFits(pane, paneSize(), zone, drag.id)) return null;
      return dockHit(rect, zone);
    },
    drop: (drag, hit) =>
      openWorkspaceRouteAt(drag.id, pane.id, hit.id as DockDropZone, props.onOpen),
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
    if (zone !== "center" && (!movingTab || !dockSplitFits(pane, paneSize(), zone, movingTab))) {
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
    if (zone !== "center" && (!movingTab || !dockSplitFits(pane, paneSize(), zone, movingTab)))
      return;
    props.onDockView(tabId, pane.id, zone);
  };

  return (
    <Surface
      as="section"
      tone="page"
      ref={sectionRef}
      className={cn(
        "group/pane relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]",
        "overflow-hidden focus:outline-none",
        "data-[window-titlebar-fallback-active=true]:pt-[var(--shell-titlebar,calc(var(--spacing)*9.5))]",
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
      <Surface
        as="header"
        tone="workspace"
        data-workspace-titlebar-fallback
        data-misty-window-titlebar-region="true"
        className={cn(
          "hidden min-w-0 text-caption",
          "group-data-[window-titlebar-fallback-active=true]/pane:absolute",
          "group-data-[window-titlebar-fallback-active=true]/pane:inset-x-0",
          "group-data-[window-titlebar-fallback-active=true]/pane:top-0",
          "group-data-[window-titlebar-fallback-active=true]/pane:flex",
          "group-data-[window-titlebar-fallback-active=true]/pane:items-center",
          "group-data-[window-titlebar-fallback-active=true]/pane:h-[var(--shell-titlebar,calc(var(--spacing)*9.5))]",
          "group-data-[window-titlebar-fallback-active=true]/pane:pl-[max(--spacing(3),var(--window-chrome-left,0px))]",
          "group-data-[window-titlebar-fallback-active=true]/pane:pr-[max(--spacing(3),var(--window-chrome-right,0px))]",
        )}
      >
        <Text tone="muted">{activeTab?.title || "New tab"}</Text>
      </Surface>
      <div
        className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-x-auto overflow-y-hidden"
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
                style={{ minWidth: dockWidgetRegistry.get(mountedTab.surfaceId).contentWidth }}
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
    </Surface>
  );
}

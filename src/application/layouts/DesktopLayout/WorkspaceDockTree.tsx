import { WorkspaceAppGallery } from "./WorkspaceAppGallery";
import { StablePaneLayout } from "@/features/workspace/StablePaneLayout";
import { panePlacement } from "@/features/workspace/panePlacement";
import { WorkspacePaneControls } from "./WorkspacePaneControls";
import { selectPaneFocusPreferences } from "@/features/workspace/paneFocus";
import { useSettingsStore } from "@/features/settings";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { usePointerDropTarget } from "@/shared/hooks/usePointerReorder";
import {
  canFitDockSplit,
  dockLeaves,
  dockWidgetRegistry,
  maxWorkspacePanels,
  spaceWorkspaceToolFromRoute,
  useWorkspaceStore,
  WorkspaceTabTitleProvider,
  type DockSplitDirection,
  type DockDropZone,
  type WorkspaceDockNode,
  type WorkspaceGroupKey,
  type WorkspacePane,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
  type WorkspaceVirtualWindow,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { WorkspaceSurface } from "./WorkspaceSurface";
import {
  AiPaneHost,
  type AiContextReference,
  type AiSuggestedAction,
  type AiSurfaceAdapter,
  type AiSurfaceId,
} from "@/features/ai-surface/AiPaneHost";
import { type NewTabOption } from "./WorkspaceNewTabMenu";
import { useSpacesStore } from "@/features/spaces";
import { type TabGroup } from "./WorkspaceTabGroupButton";

const surfaceLabels: Record<WorkspaceSurfaceId, string> = {
  home: "Home",
  inbox: "Inbox",
  space: "Space",
  browser: "Browser",
  terminal: "Terminal",
  code: "Code",
  files: "Files",
  transfers: "Transfers",
  agents: "Agents",
  "official-app": "App",
  extension: "App",
  marketplace: "Discover",
};
const tabDragType = "application/x-misty-workspace-tab";

export function groupTabs(tabs: WorkspaceTab[]): TabGroup[] {
  const map = new Map<string, TabGroup>();
  const spaces = useSpacesStore.getState().spaces;
  for (const tab of tabs) {
    let key = tab.groupKey;
    let label = surfaceLabels[tab.surfaceId] ?? tab.title ?? "Tool";
    let contextLabel = label;
    if (tab.surfaceId === "space") {
      const routeParts = tab.route.split("?")[0].split("/").filter(Boolean);
      const groupParts = tab.groupKey.split(":");
      const spaceId = safeRouteDecode(routeParts[1] ?? groupParts[1] ?? "");
      const tool = spaceWorkspaceToolFromRoute(tab.route);
      key = (
        tool === "space" ? `space:${spaceId}` : `space:${spaceId}:${tool}`
      ) as WorkspaceGroupKey;
      const space = spaces.find((s) => s.id === spaceId);
      const spaceName = space?.name || "Space";
      const isHome = routeParts[2] === "home";
      label = tool === "space" ? (isHome ? "Home" : "Space") : spaceToolLabel(tool);
      contextLabel = `${spaceName} · ${label}`;
    } else if (tab.surfaceId === "official-app") {
      const id = tab.groupKey.replace(/^app:/, "").split(":")[0];
      label =
        (
          {
            chat: "Social",
            social: "Social",
            inbox: "Inbox",
            journal: "Journal",
            planner: "Planner",
            library: "Library",
            browser: "Browser",
            files: "Files",
            code: "Code",
            terminal: "Terminal",
            agents: "Agents",
            transfers: "Transfers",
          } as Record<string, string>
        )[id] ??
        useAppsStore.getState().catalog.find((app) => app.id === id)?.name ??
        "App";
      contextLabel = label;
    }
    const existing = map.get(key);
    if (existing) {
      existing.tabs.push(tab);
    } else {
      map.set(key, {
        key,
        instanceId: tab.groupInstanceId ?? `group:${tab.id}`,
        surfaceId: tab.surfaceId,
        label,
        contextLabel,
        tabs: [tab],
        storeGroupKey: key as WorkspaceGroupKey,
      });
    }
  }
  return [...map.values()];
}

export function tabForGroupedShortcut(
  tabs: WorkspaceTab[],
  index: number | "last",
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>,
): WorkspaceTab | null {
  const groups = groupTabs(tabs);
  const group = index === "last" ? groups[groups.length - 1] : groups[index];
  if (!group) return null;
  const preferredId = group.storeGroupKey
    ? (lastUsedTabByGroup[group.storeGroupKey] ??
      lastUsedTabByGroup[`tool:${group.surfaceId}` as WorkspaceGroupKey])
    : undefined;
  return (
    (preferredId ? group.tabs.find((tab) => tab.id === preferredId) : undefined) ??
    [...group.tabs].sort((left, right) => right.lastFocusedAt - left.lastFocusedAt)[0] ??
    null
  );
}

function spaceToolLabel(tool: ReturnType<typeof spaceWorkspaceToolFromRoute>): string {
  if (tool === "journal") return "Journal";
  if (tool === "planner") return "Planner";
  if (tool === "social") return "Social";
  if (tool === "library") return "Library";
  return "Space";
}

export interface WorkspaceDockTreeProps {
  workspaceActive?: boolean;
  node: WorkspaceDockNode;
  dockEdge?: { top: boolean; left: boolean; right: boolean };
  panelDirection?: DockSplitDirection;
  titlebarInsets?: { left: number; right: number };
  windowsTitlebarControls?: boolean;
  focusedPaneId: string;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  onOpen: (tab: WorkspaceTab) => void;
  onClose: (tab: WorkspaceTab, paneId: string) => void;
  onOpenNewTab: (option: NewTabOption, paneId: string) => void;
  onMoveTab: (tabId: string, paneId: string, index?: number) => boolean;
  onDockTab: (tabId: string, paneId: string, zone: DockDropZone, index?: number) => boolean;
  onSplitPane: (paneId: string, direction: DockSplitDirection, tabId?: string) => string | null;
  onClosePane: (paneId: string) => void;
  virtualWindows: WorkspaceVirtualWindow[];
  activeVirtualWindowId: string;
  canReopenVirtualWindow: boolean;
  onSelectVirtualWindow: (windowId: string) => void;
  onCreateVirtualWindow: () => void;
  onCloseVirtualWindow: (windowId: string) => void;
  onReopenVirtualWindow: () => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
}

export function WorkspaceDockTree(props: WorkspaceDockTreeProps) {
  const panes = dockLeaves(props.node).map((pane) => ({
    id: pane.id,
    content: <DockLeafView {...props} node={pane} pane={pane} />,
  }));
  return (
    <StablePaneLayout panes={panes}>
      <DockLayoutNode {...props} />
    </StablePaneLayout>
  );
}

function DockLayoutNode(props: WorkspaceDockTreeProps) {
  if (props.node.type === "leaf")
    return <div data-pane-layout-slot={props.node.id} className="h-full min-h-0 w-full min-w-0" />;
  return <DockSplitView key={props.node.id} {...props} node={props.node} />;
}

function DockSplitView(
  props: WorkspaceDockTreeProps & { node: Extract<WorkspaceDockNode, { type: "split" }> },
) {
  const edge = props.dockEdge ?? { top: true, left: true, right: true };
  const firstEdge =
    props.node.direction === "horizontal"
      ? { top: edge.top, left: edge.left, right: false }
      : { top: edge.top, left: edge.left, right: edge.right };
  const secondEdge =
    props.node.direction === "horizontal"
      ? { top: edge.top, left: false, right: edge.right }
      : { top: false, left: edge.left, right: edge.right };
  const persistTimerRef = useRef<number | null>(null);
  const pendingRatioRef = useRef(props.node.ratio);
  const panelGroupRef = useRef<ImperativePanelGroupHandle | null>(null);
  useEffect(() => {
    const handle = panelGroupRef.current;
    const layout = handle?.getLayout();
    if (!handle || layout?.length !== 2) return;
    const desired = props.node.ratio * 100;
    if (Math.abs((layout[0] ?? desired) - desired) < 0.1) return;
    pendingRatioRef.current = props.node.ratio;
    handle.setLayout([desired, 100 - desired]);
  }, [props.node.ratio]);
  useEffect(
    () => () => {
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    },
    [],
  );
  return (
    <PanelGroup
      ref={panelGroupRef}
      id={props.node.id}
      direction={props.node.direction}
      className="h-full min-h-0 w-full min-w-0"
      onLayout={(sizes) => {
        pendingRatioRef.current = (sizes[0] ?? 50) / 100;
        if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = window.setTimeout(() => {
          persistTimerRef.current = null;
          props.onResizeSplit(props.node.id, pendingRatioRef.current);
        }, 120);
      }}
    >
      <Panel
        id={`${props.node.id}:first`}
        order={1}
        defaultSize={props.node.ratio * 100}
        minSize={15}
        className="min-h-0 min-w-0"
      >
        <DockLayoutNode
          {...props}
          node={props.node.first}
          dockEdge={firstEdge}
          panelDirection={props.node.direction === "horizontal" ? "left" : "up"}
        />
      </Panel>
      <PanelResizeHandle
        aria-label={
          props.node.direction === "horizontal"
            ? "Resize panes horizontally"
            : "Resize panes vertically"
        }
        className={cn(
          "relative z-20 bg-charcoal-border transition-colors before:absolute",
          "hover:bg-charcoal-active focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-cream-muted/60 data-[resize-handle-active]:bg-charcoal-active",
          props.node.direction === "horizontal"
            ? "w-px cursor-col-resize before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2"
            : "h-px cursor-row-resize before:inset-x-0 before:top-1/2 before:h-3 before:-translate-y-1/2",
        )}
      />
      <Panel
        id={`${props.node.id}:second`}
        order={2}
        defaultSize={(1 - props.node.ratio) * 100}
        minSize={15}
        className="min-h-0 min-w-0"
      >
        <DockLayoutNode
          {...props}
          node={props.node.second}
          dockEdge={secondEdge}
          panelDirection={props.node.direction === "horizontal" ? "right" : "down"}
        />
      </Panel>
    </PanelGroup>
  );
}

function DockLeafView(props: WorkspaceDockTreeProps & { pane: WorkspacePane }) {
  const { pane } = props;
  const sectionRef = useRef<HTMLElement | null>(null);
  const [dropZone, setDropZone] = useState<DockDropZone | null>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
  const focused = props.workspaceActive !== false && pane.id === props.focusedPaneId;
  // Open tabs own live UI state and subscriptions. Hiding an inactive surface
  // must not unmount it, otherwise collaborative tools reconnect and reload on
  // every tab switch. Closing the tab remains the lifecycle boundary.
  const mountedTabs = [...pane.tabs].sort((a, b) => a.id.localeCompare(b.id));
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
        .dockTabGroup(drag.ids ?? [drag.id], pane.id, hit.id as DockDropZone);
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
    if (!event.dataTransfer.types.includes(tabDragType)) return;
    event.preventDefault();
    const zone = dropZoneAt(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const movingTabId = event.dataTransfer.getData(tabDragType);
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
    const tabId = event.dataTransfer.getData(tabDragType);
    const zone = dropZone ?? "center";
    setDropZone(null);
    if (!tabId) return;
    const movingTab = allLayoutViews(useWorkspaceStore.getState().layout).find(
      (tab) => tab.id === tabId,
    );
    if (zone !== "center" && (!movingTab || !dockSplitFits(pane, paneSize, zone, movingTab)))
      return;
    props.onDockTab(tabId, pane.id, zone);
  };

  return (
    <section
      ref={sectionRef}
      className={cn(
        "group/pane relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]",
        "overflow-hidden bg-charcoal-bg focus:outline-none focus-visible:ring-2",
        "focus-visible:ring-inset focus-visible:ring-cream-muted/50",
      )}
      data-workspace-pane={pane.id}
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
        else useWorkspaceStore.getState().focusTab(activeTab.id);
      }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden">
        {activeTab
          ? mountedTabs.map((mountedTab) => {
              const isActive = props.workspaceActive !== false && mountedTab.id === activeTab.id;
              return (
                <div
                  key={mountedTab.id}
                  className={cn("h-full min-h-0 w-full", isActive ? "block" : "hidden")}
                  aria-hidden={!isActive}
                >
                  {mountedTab.placeholder ? (
                    <WorkspaceAppGallery paneId={pane.id} onOpenNewTab={props.onOpenNewTab} />
                  ) : (
                    <AiPaneHost
                      paneId={pane.id}
                      defaultAdapter={workspaceAiAdapter(mountedTab)}
                      active={isActive}
                    >
                      <WorkspaceTabTitleProvider tabId={mountedTab.id}>
                        <WorkspaceSurface tab={mountedTab} active={isActive} />
                      </WorkspaceTabTitleProvider>
                    </AiPaneHost>
                  )}
                </div>
              );
            })
          : null}
      </div>
      {dim > 0 ? (
        <div
          data-pane-dim
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 bg-black"
          style={{ opacity: dim }}
        />
      ) : null}
      {focused && focusPreferences.indicator !== "none" ? (
        <div
          data-pane-focus
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-20",
            focusPreferences.indicator === "border"
              ? "ring-2 ring-inset ring-cream-muted"
              : "ring-1 ring-inset ring-cream-muted/50",
          )}
        />
      ) : null}
      <WorkspacePaneControls pane={pane} onClose={() => props.onClosePane(pane.id)} />
      {dropZone ? <DockDropPreview zone={dropZone} /> : null}
    </section>
  );
}

function workspaceAiAdapter(tab: WorkspaceTab | undefined): AiSurfaceAdapter | null {
  if (!tab) return null;
  const surfaceId = aiSurfaceForTab(tab);
  const context = aiContextForTab(tab);
  return {
    surfaceId,
    label: tab.title || surfaceLabels[tab.surfaceId] || "Tool",
    getContext: () => [context],
    getSuggestedActions: () => workspaceAiActions[surfaceId] ?? [],
    openCitation: (citation) =>
      window.dispatchEvent(new CustomEvent("misty:open-ai-citation", { detail: citation })),
  };
}

function aiSurfaceForTab(tab: WorkspaceTab): AiSurfaceId {
  if (tab.surfaceId === "official-app") return "extension";
  if (tab.surfaceId !== "space") return tab.surfaceId;
  const parts = tab.route.split("?")[0].split("/").filter(Boolean);
  const section = parts[2] ?? "";
  const view = parts[3] ?? "";
  if (section === "notes") return "notes";
  if (section === "drawings") return "drawings";
  if (section === "social" || section === "chat") return "space.chat";
  if (section === "library") return "library";
  if (section === "activity") return "activity";
  if (section === "planner") {
    if (view === "agenda") return "planner.agenda";
    if (view === "roadmaps" || view === "goals" || view === "milestones") return "planner.roadmap";
    return "planner.tasks";
  }
  return "settings";
}

function aiContextForTab(tab: WorkspaceTab): AiContextReference {
  if (tab.surfaceId === "space") {
    const parts = tab.route.split("?")[0].split("/").filter(Boolean);
    const spaceId = safeRouteDecode(parts[1] ?? "");
    return {
      kind: "space",
      id: `${spaceId}:${parts[2] ?? "overview"}:${parts[3] ?? "default"}`,
      title: tab.title,
      privacy: "shared",
      spaceId,
    };
  }
  const privacy =
    tab.surfaceId === "inbox"
      ? "provider"
      : (["browser", "terminal", "code", "files", "transfers"] as WorkspaceSurfaceId[]).includes(
            tab.surfaceId,
          )
        ? "device"
        : "private";
  return {
    kind:
      privacy === "device" ? "device-scope" : privacy === "provider" ? "provider-scope" : "route",
    id: tab.id,
    title: tab.title || surfaceLabels[tab.surfaceId] || "Tool",
    privacy,
    opaqueScopeId: privacy === "device" ? tab.instanceKey : undefined,
  };
}

const action = (id: string, label: string, prompt: string): AiSuggestedAction => ({
  id,
  label,
  prompt,
  trigger: "object",
});

const workspaceAiActions: Partial<Record<AiSurfaceId, AiSuggestedAction[]>> = {
  activity: [
    action("activity.catch-up", "Catch me up", "Summarize unread activity by outcome and Space."),
  ],
  inbox: [
    action("inbox.summarize", "Summarize", "Summarize the visible inbox context."),
    action(
      "inbox.triage",
      "Suggest triage",
      "Suggest a triage plan without changing any messages.",
    ),
  ],
  "space.chat": [
    action(
      "chat.recap",
      "Recap",
      "Recap the visible conversation, including decisions and open questions.",
    ),
    action(
      "chat.actions",
      "Find action items",
      "Identify action items and owners. Do not create tasks yet.",
    ),
  ],
  "planner.tasks": [
    action(
      "planner.status",
      "Summarize status",
      "Summarize the visible plan's status, risks, and blockers.",
    ),
    action(
      "planner.breakdown",
      "Draft breakdown",
      "Draft a practical task breakdown for the visible plan.",
    ),
  ],
  "planner.agenda": [
    action(
      "agenda.plan",
      "Plan my day",
      "Propose a realistic plan for the visible agenda without scheduling anything.",
    ),
  ],
  "planner.roadmap": [
    action(
      "roadmap.risks",
      "Find risks",
      "Assess dependencies, schedule risks, and likely bottlenecks in this roadmap.",
    ),
  ],
  browser: [
    action(
      "browser.summary",
      "Summarize page",
      "Summarize the attached browser page and cite its key sections.",
    ),
    action(
      "browser.explain",
      "Explain page",
      "Explain the attached browser page in plain language.",
    ),
  ],
  code: [
    action(
      "code.explain",
      "Explain code",
      "Explain the visible code and its important dependencies.",
    ),
    action("code.review", "Review", "Review the visible code for correctness and maintainability."),
  ],
  terminal: [
    action(
      "terminal.explain",
      "Explain output",
      "Explain the visible terminal block and suggest a safe next step.",
    ),
  ],
  files: [
    action(
      "files.organize",
      "Suggest cleanup",
      "Suggest a reversible cleanup plan for the selected files.",
    ),
  ],
  transfers: [
    action(
      "transfers.diagnose",
      "Diagnose",
      "Diagnose the visible transfer state and suggest recovery steps.",
    ),
  ],
  drawings: [
    action(
      "drawings.summarize",
      "Summarize board",
      "Summarize the selected or visible drawing objects.",
    ),
  ],
  library: [
    action(
      "library.synthesize",
      "Synthesize",
      "Synthesize the visible Library sources with citations.",
    ),
  ],
  marketplace: [
    action(
      "marketplace.explain",
      "Explain",
      "Explain the visible Discover item and what access it needs.",
    ),
  ],
};

function safeRouteDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function DockDropPreview({ zone }: { zone: DockDropZone }) {
  const position =
    zone === "center"
      ? "inset-3"
      : zone === "left"
        ? "inset-y-2 left-2 w-[42%]"
        : zone === "right"
          ? "inset-y-2 right-2 w-[42%]"
          : zone === "up"
            ? "inset-x-2 top-2 h-[42%]"
            : "inset-x-2 bottom-2 h-[42%]";
  return (
    <div
      className={`pointer-events-none absolute z-50 rounded-md border border-cream-muted/70 bg-cream-muted/15 ${position}`}
    />
  );
}

function dropZoneAt(rect: DOMRect, x: number, y: number): DockDropZone {
  const localX = (x - rect.left) / Math.max(1, rect.width);
  const localY = (y - rect.top) / Math.max(1, rect.height);
  const edge = 0.24;
  if (localX < edge) return "left";
  if (localX > 1 - edge) return "right";
  if (localY < edge) return "up";
  if (localY > 1 - edge) return "down";
  return "center";
}

function dockSplitFits(
  pane: WorkspacePane,
  available: { width: number; height: number },
  zone: DockDropZone,
  movingTab: WorkspaceTab,
): boolean {
  if (zone === "center") return true;
  if (dockLeaves(useWorkspaceStore.getState().layout.root).length >= maxWorkspacePanels)
    return false;
  const remaining = pane.tabs.filter((tab) => tab.id !== movingTab.id);
  if (!remaining.length) return false;
  return canFitDockSplit(
    available,
    zone,
    minimumForWorkspaceTabs(remaining),
    dockWidgetRegistry.get(movingTab.surfaceId).minimumSize,
  );
}

export function minimumForWorkspaceTabs(tabs: WorkspaceTab[]): { width: number; height: number } {
  return tabs.reduce(
    (minimum, tab) => {
      const next = dockWidgetRegistry.get(tab.surfaceId).minimumSize;
      return {
        width: Math.max(minimum.width, next.width),
        height: Math.max(minimum.height, next.height),
      };
    },
    { width: 280, height: 180 },
  );
}

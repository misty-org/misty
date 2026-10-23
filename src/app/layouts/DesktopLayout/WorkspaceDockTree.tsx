import { StablePaneLayout } from "@/features/workspace/StablePaneLayout";
import {
  dockLeaves,
  type DockSplitDirection,
  type DockDropZone,
  type WorkspaceDockNode,
  type WorkspaceGroupKey,
  type WorkspaceView,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import { useEffect, useRef } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { DockLeafView } from "./DockLeafView";

export interface WorkspaceDockTreeProps {
  workspaceActive?: boolean;
  node: WorkspaceDockNode;
  dockEdge?: { top: boolean; left: boolean; right: boolean };
  paneDirection?: DockSplitDirection;
  windowsTitlebarControls?: boolean;
  focusedPaneId: string;
  lastUsedViewByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  onOpen: (tab: WorkspaceView) => void;
  onClose: (tab: WorkspaceView, paneId: string) => void;
  onMoveView: (tabId: string, paneId: string, index?: number) => boolean;
  onDockView: (tabId: string, paneId: string, zone: DockDropZone, index?: number) => boolean;
  onSplitPane: (paneId: string, direction: DockSplitDirection, tabId?: string) => string | null;
  onClosePane: (paneId: string) => void;
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
  const splitGroupRef = useRef<ImperativePanelGroupHandle | null>(null);
  useEffect(() => {
    const handle = splitGroupRef.current;
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
      ref={splitGroupRef}
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
          paneDirection={props.node.direction === "horizontal" ? "left" : "up"}
        />
      </Panel>
      <PanelResizeHandle
        aria-label={
          props.node.direction === "horizontal"
            ? "Resize panes horizontally"
            : "Resize panes vertically"
        }
        className={cn(
          // Panes are separate rounded containers, so the handle is the gap between them.
          "relative z-20 bg-transparent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted/60",
          props.node.direction === "horizontal" ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
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
          paneDirection={props.node.direction === "horizontal" ? "right" : "down"}
        />
      </Panel>
    </PanelGroup>
  );
}

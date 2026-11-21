import { StablePaneLayout } from "@/features/app-windows";
import {
  dockLeaves,
  type DockSplitDirection,
  type DockDropZone,
  type WorkspaceDockNode,
  type WorkspaceGroupKey,
  type WorkspaceView,
} from "@/features/app-windows";
import {
  SplitHandle,
  SplitPane as Panel,
  SplitPanes as PanelGroup,
  type SplitPanesHandle as ImperativePanelGroupHandle,
} from "@misty/ui";
import { useEffect, useRef } from "react";
import { DockLeafView } from "./DockLeafView";

export interface WorkspaceDockTreeProps {
  workspaceActive?: boolean;
  node: WorkspaceDockNode;
  dockEdge?: { top: boolean; left: boolean; right: boolean };
  paneDirection?: DockSplitDirection;
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

/** How near (as a share of the split) a seam has to come to an even or lined-up spot to snap. */
const snapReach = 0.025;

/**
 * Where a split's seam snaps while dragged: halfway, and in a 2 by 2 grid in line with the seam
 * across from it (`alignRatio`), so each pane resizes on its own and still falls back onto the
 * grid easily.
 */
function snappedRatio(ratio: number, alignRatio?: number): number | null {
  const spots = alignRatio === undefined ? [0.5] : [0.5, alignRatio];
  const spot = spots.find((target) => Math.abs(ratio - target) < snapReach);
  return spot === undefined || Math.abs(ratio - spot) < 0.001 ? null : spot;
}

/** The ratio of the split across from `node`'s sibling, when the two line up as a grid's rows. */
function crossRatio(node: WorkspaceDockNode, other: WorkspaceDockNode): number | undefined {
  return node.type === "split" && other.type === "split" && node.direction === other.direction
    ? other.ratio
    : undefined;
}

function DockLayoutNode(props: WorkspaceDockTreeProps & { alignRatio?: number }) {
  if (props.node.type === "leaf")
    return <div data-pane-layout-slot={props.node.id} className="h-full min-h-0 w-full min-w-0" />;
  return <DockSplitView key={props.node.id} {...props} node={props.node} />;
}

function DockSplitView(
  props: WorkspaceDockTreeProps & {
    node: Extract<WorkspaceDockNode, { type: "split" }>;
    alignRatio?: number;
  },
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
        const ratio = (sizes[0] ?? 50) / 100;
        // Near halfway, or in line with the seam across from it, the seam snaps there.
        const snapped = snappedRatio(ratio, props.alignRatio);
        if (snapped !== null) {
          splitGroupRef.current?.setLayout([snapped * 100, 100 - snapped * 100]);
          return;
        }
        pendingRatioRef.current = ratio;
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
          alignRatio={crossRatio(props.node.first, props.node.second)}
          dockEdge={firstEdge}
          paneDirection={props.node.direction === "horizontal" ? "left" : "up"}
        />
      </Panel>
      <SplitHandle
        seam
        direction={props.node.direction}
        // Back onto the grid: the two sides even again.
        onDoubleClick={() => splitGroupRef.current?.setLayout([50, 50])}
        label={
          props.node.direction === "horizontal"
            ? "Resize panes horizontally"
            : "Resize panes vertically"
        }
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
          alignRatio={crossRatio(props.node.second, props.node.first)}
          dockEdge={secondEdge}
          paneDirection={props.node.direction === "horizontal" ? "right" : "down"}
        />
      </Panel>
    </PanelGroup>
  );
}

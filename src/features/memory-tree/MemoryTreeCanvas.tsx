import "@xyflow/react/dist/base.css";
import "./memoryTree.css";
import { Background, Controls, type Edge, ReactFlow, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { layoutTree, NODE_H, NODE_W, type Point } from "./layout";
import { MemoryEdge } from "./nodes/MemoryEdge";
import { type MemoryFlowNode, MemoryTreeNode } from "./nodes/MemoryTreeNode";
import { useAnimatedPositions } from "./useAnimatedPositions";
import { useMemoryTreeStore } from "./useMemoryTreeStore";
import { visibleTree } from "./visibleTree";

const nodeTypes = { memory: MemoryTreeNode };
const edgeTypes = { memory: MemoryEdge };

const FIT_PADDING = 56;

/**
 * Centers the tree in the canvas whenever its shape changes. It fits the layout the nodes are
 * gliding to, not where they are mid-glide, so the view never lands off-center.
 */
function CenterOnLayout({
  target,
  signature,
}: {
  target: ReadonlyMap<string, Point>;
  signature: string;
}) {
  const { setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (!width || !height || target.size === 0) return;
    const points = [...target.values()];
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const boundsW = Math.max(...points.map((p) => p.x)) + NODE_W - minX;
    const boundsH = Math.max(...points.map((p) => p.y)) + NODE_H - minY;
    const zoom = Math.min(
      1,
      Math.max(
        0.3,
        Math.min((width - FIT_PADDING * 2) / boundsW, (height - FIT_PADDING * 2) / boundsH),
      ),
    );
    void setViewport(
      {
        zoom,
        x: (width - boundsW * zoom) / 2 - minX * zoom,
        y: (height - boundsH * zoom) / 2 - minY * zoom,
      },
      { duration: 600 },
    );
    // Only a change of shape recenters; a pan or zoom the person made is left alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, width, height, setViewport]);
  return null;
}

export function MemoryTreeCanvas({ spaceName }: { spaceName: string }) {
  const { children, expanded, hidden } = useMemoryTreeStore(
    useShallow((s) => ({ children: s.children, expanded: s.expanded, hidden: s.hidden })),
  );
  const visible = useMemo(
    () => visibleTree(children, expanded, hidden),
    [children, expanded, hidden],
  );
  const target = useMemo(() => layoutTree(visible), [visible]);
  const parentOf = useMemo(() => new Map(visible.map((v) => [v.id, v.parent])), [visible]);
  const positions = useAnimatedPositions(target, parentOf);
  const select = useMemoryTreeStore((s) => s.select);

  const nodes = useMemo<MemoryFlowNode[]>(
    () =>
      visible.map((item) => ({
        id: item.id,
        type: "memory",
        position: positions.get(item.id) ?? target.get(item.id) ?? { x: 0, y: 0 },
        data: { item, spaceName },
        width: NODE_W,
        height: NODE_H,
        draggable: false,
        connectable: false,
      })),
    [visible, positions, target, spaceName],
  );
  const edges = useMemo<Edge[]>(
    () =>
      visible
        .filter((item) => item.parent !== null)
        .map((item) => ({
          id: `${item.parent}>${item.id}`,
          source: item.parent as string,
          target: item.id,
          type: "memory",
          selectable: false,
          focusable: false,
        })),
    [visible],
  );
  const signature = useMemo(() => visible.map((v) => v.id).join("|"), [visible]);

  return (
    <ReactFlow
      className="memory-flow"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      // Nodes must stay selectable: React Flow turns off pointer events on nodes that are not.
      elementsSelectable
      minZoom={0.3}
      maxZoom={1.4}
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      aria-label="Memory tree"
      // A press on empty canvas, or the person moving the view, closes an open memory.
      onPaneClick={() => select(null)}
      onMoveStart={(event) => event && select(null)}
    >
      <Background gap={22} size={1} color="var(--misty-theme-border)" />
      <Controls showInteractive={false} position="bottom-left" />
      <CenterOnLayout target={target} signature={signature} />
    </ReactFlow>
  );
}

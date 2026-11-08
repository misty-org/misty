import "@xyflow/react/dist/base.css";
import "./memoryTree.css";
import {
  Background,
  Controls,
  type Edge,
  type NodeChange,
  ReactFlow,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { layoutTree, NODE_H, NODE_W, type Point } from "./layout";
import { drawnEdges } from "./nodes/drawnEdges";
import { MemoryEdge } from "./nodes/MemoryEdge";
import { type MemoryFlowNode, MemoryTreeNode } from "./nodes/MemoryTreeNode";
import { useAnimatedPositions } from "./useAnimatedPositions";
import { useMemoryTreeStore } from "./useMemoryTreeStore";
import { visibleTree } from "./visibleTree";

const nodeTypes = { memory: MemoryTreeNode };
const edgeTypes = { memory: MemoryEdge };

const FIT_PADDING = 56;

/**
 * Fits the tree in the canvas once, when it first has a size. After that the view stays where the
 * person put it; it only moves when opening a node would carry the tree out of sight, and then
 * to fit the layout the nodes are gliding to. A resize or a popover opening never refits.
 */
function CenterOnLayout({
  target,
  signature,
}: {
  target: ReadonlyMap<string, Point>;
  signature: string;
}) {
  const { setViewport, getViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const fitted = useRef(false);
  useEffect(() => {
    if (!width || !height || target.size === 0) return;
    const points = [...target.values()];
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const boundsW = Math.max(...points.map((p) => p.x)) + NODE_W - minX;
    const boundsH = Math.max(...points.map((p) => p.y)) + NODE_H - minY;
    if (fitted.current) {
      const view = getViewport();
      const inSight =
        minX * view.zoom + view.x >= 0 &&
        minY * view.zoom + view.y >= 0 &&
        (minX + boundsW) * view.zoom + view.x <= width &&
        (minY + boundsH) * view.zoom + view.y <= height;
      if (inSight) return;
    }
    fitted.current = true;
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
    // Only a change of shape (or the first size) refits; a resize alone is left alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, !width || !height, setViewport]);
  return null;
}

/** The previous value while the new one holds the same thing, so effects keyed on it stay quiet. */
function useStable<T>(value: T, same: (a: T, b: T) => boolean): T {
  const kept = useRef(value);
  if (kept.current !== value && !same(kept.current, value)) kept.current = value;
  return kept.current;
}

const sameMap = <V,>(
  a: ReadonlyMap<string, V>,
  b: ReadonlyMap<string, V>,
  eq: (x: V, y: V) => boolean,
) => a.size === b.size && [...a].every(([id, value]) => b.has(id) && eq(value, b.get(id) as V));

const shiftedBy = (at: Point, shift?: Point): Point =>
  shift ? { x: at.x + shift.x, y: at.y + shift.y } : at;

export function MemoryTreeCanvas({ spaceName }: { spaceName: string }) {
  const { children, expanded, hidden } = useMemoryTreeStore(
    useShallow((s) => ({ children: s.children, expanded: s.expanded, hidden: s.hidden })),
  );
  const visible = useMemo(
    () => visibleTree(children, expanded, hidden),
    [children, expanded, hidden],
  );
  // A reload that changes nothing about the shape must not glide or redraw anything.
  const laidOut = useMemo(() => layoutTree(visible), [visible]);
  const target = useStable(laidOut, (a, b) => sameMap(a, b, (p, q) => p.x === q.x && p.y === q.y));
  const parents = useMemo(() => new Map(visible.map((v) => [v.id, v.parent])), [visible]);
  const parentOf = useStable(parents, (a, b) => sameMap(a, b, (p, q) => p === q));
  const positions = useAnimatedPositions(target, parentOf);
  const select = useMemoryTreeStore((s) => s.select);
  useEffect(() => () => drawnEdges.clear(), []);
  // Where the person dragged each node, kept as a shift from the layout so it survives relayouts.
  const [shifts, setShifts] = useState<ReadonlyMap<string, Point>>(new Map());
  // React Flow reports a drag as position changes, and a controlled flow has to take them.
  const shown = useRef(positions);
  shown.current = positions;
  const onNodesChange = useCallback(
    (changes: NodeChange<MemoryFlowNode>[]) => {
      const moved = changes.filter((change) => change.type === "position" && change.position);
      if (moved.length === 0) return;
      setShifts((prev) => {
        const next = new Map(prev);
        for (const change of moved) {
          if (change.type !== "position" || !change.position) continue;
          const base = shown.current.get(change.id) ?? target.get(change.id);
          if (base)
            next.set(change.id, { x: change.position.x - base.x, y: change.position.y - base.y });
        }
        return next;
      });
    },
    [target],
  );

  const nodes = useMemo<MemoryFlowNode[]>(
    () =>
      visible.map((item) => ({
        id: item.id,
        type: "memory",
        position: shiftedBy(
          positions.get(item.id) ?? target.get(item.id) ?? { x: 0, y: 0 },
          shifts.get(item.id),
        ),
        data: { item, spaceName },
        width: NODE_W,
        height: NODE_H,
        draggable: true,
        connectable: false,
      })),
    [visible, positions, target, shifts, spaceName],
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
      nodesDraggable
      nodeDragThreshold={4}
      onNodesChange={onNodesChange}
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

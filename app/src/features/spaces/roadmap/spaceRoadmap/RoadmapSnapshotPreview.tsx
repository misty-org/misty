import { useAppThemeStore } from "@/features/settings";
import type { SpaceRoadmapSnapshot } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import {
  roadmapNodeTypes,
  snapshotRoadmapEdges,
  snapshotRoadmapNodes,
  type RoadmapNode,
} from "./RoadmapCanvasNodes";

/** A fitted, non-interactive view of the actual roadmap canvas. */
export function RoadmapSnapshotPreview({ snapshot }: { snapshot: SpaceRoadmapSnapshot }) {
  return (
    <ReactFlowProvider>
      <RoadmapSnapshotFlow snapshot={snapshot} />
    </ReactFlowProvider>
  );
}

function RoadmapSnapshotFlow({ snapshot }: { snapshot: SpaceRoadmapSnapshot }) {
  const resolvedTheme = useAppThemeStore((state) => state.resolvedTheme);
  const nodes = useMemo<RoadmapNode[]>(
    () => snapshotRoadmapNodes(snapshot, new Set<string>(), () => undefined),
    [snapshot],
  );
  const edges = useMemo(() => snapshotRoadmapEdges(snapshot, nodes), [nodes, snapshot]);

  return (
    <div
      className="relative h-full min-h-[22rem] overflow-hidden bg-charcoal-card"
      aria-label={`${snapshot.roadmap.name} snapshot`}
    >
      <ReactFlow
        className="pointer-events-none"
        colorMode={resolvedTheme}
        nodes={nodes}
        edges={edges}
        nodeTypes={roadmapNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1.05 }}
        minZoom={0.25}
        maxZoom={1.05}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>
      {!nodes.length ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-xs text-cream-muted">
          Add a milestone or goal to build this roadmap.
        </div>
      ) : null}
    </div>
  );
}

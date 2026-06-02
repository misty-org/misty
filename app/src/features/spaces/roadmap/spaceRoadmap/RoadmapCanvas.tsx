import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { useAuth } from "@/features/auth";
import { useAppThemeStore } from "@/features/settings";
import { useShortcutHandler } from "@/features/shortcuts";
import type {
  SpaceRoadmapEdgeType,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { Button } from "@/shared/ui";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraphToolbar } from "../graphCanvas/GraphToolbar";
import { useGraphHistory } from "../graphCanvas/useGraphHistory";
import {
  reparentRoadmapNode,
  roadmapNodeTypes,
  snapshotRoadmapEdges,
  snapshotRoadmapNodes,
  type RoadmapNode,
  type RoadmapNodeData,
} from "./RoadmapCanvasNodes";
import {
  allowedRoadmapEdgeTypes,
  roadmapEdgeLabels,
  roadmapNodeColors,
} from "./roadmapNodeCatalog";

export function RoadmapCanvas(props: {
  snapshot: SpaceRoadmapSnapshot;
  selectedId: string;
  canManage: boolean;
  expandedGoalIds: Set<string>;
  focusRequest?: { id: string; token: string };
  placementRequest?: { paletteId: string; token: string };
  onPlacementHandled: () => void;
  onToggleGoal: (goalId: string) => void;
  onOpenTask: (taskId: string) => void;
  onSelect: (id: string, anchor?: { x: number; y: number }) => void;
  onLayout: (nodes: RoadmapNode[]) => void;
  onConnect: (connection: Connection, edgeType: SpaceRoadmapEdgeType) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddAt: (paletteId: string, position: { x: number; y: number }) => void;
}) {
  return (
    <ReactFlowProvider>
      <RoadmapFlow {...props} />
    </ReactFlowProvider>
  );
}

function RoadmapFlow(props: Parameters<typeof RoadmapCanvas>[0]) {
  const { user } = useAuth();
  const resolvedTheme = useAppThemeStore((state) => state.resolvedTheme);
  const { fitView, screenToFlowPosition } = useReactFlow<RoadmapNode, Edge>();
  const viewportKey = `misty:roadmap-viewport:${user?.id ?? "anonymous"}:${props.snapshot.roadmap.space_id}:${props.snapshot.roadmap.id}`;
  const savedViewport = useMemo(() => readViewport(viewportKey), [viewportKey]);
  const initialNodes = useMemo(
    () => snapshotRoadmapNodes(props.snapshot, props.expandedGoalIds, props.onToggleGoal),
    [props.expandedGoalIds, props.onToggleGoal, props.snapshot],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<RoadmapNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    snapshotRoadmapEdges(props.snapshot, initialNodes),
  );
  const [pendingConnection, setPendingConnection] = useState<{
    connection: Connection;
    types: SpaceRoadmapEdgeType[];
  }>();
  const nodesRef = useRef(nodes);
  const copiedNodeRef = useRef("");
  const resizingRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const placedRequestRef = useRef("");
  const fittedRef = useRef(Boolean(savedViewport));
  const history = useGraphHistory<RoadmapNode>();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    const nextNodes = snapshotRoadmapNodes(
      props.snapshot,
      props.expandedGoalIds,
      props.onToggleGoal,
    );
    setNodes(nextNodes);
    setEdges(snapshotRoadmapEdges(props.snapshot, nextNodes));
  }, [props.expandedGoalIds, props.onToggleGoal, props.snapshot, setEdges, setNodes]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    if (!nodesInitialized || fittedRef.current || !nodes.length) return;
    fittedRef.current = true;
    const frame = window.requestAnimationFrame(
      () => void fitView({ padding: 0.1, maxZoom: 1.08, duration: 260 }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, nodes.length, nodesInitialized]);
  useEffect(() => {
    if (!props.focusRequest || !nodesInitialized) return;
    const frame = window.requestAnimationFrame(
      () =>
        void fitView({
          nodes: [{ id: props.focusRequest!.id }],
          padding: 1.25,
          minZoom: 0.72,
          maxZoom: 1.08,
          duration: 320,
        }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, nodesInitialized, props.focusRequest]);
  useEffect(() => {
    const request = props.placementRequest;
    const canvas = canvasRef.current;
    if (!request || !canvas || placedRequestRef.current === request.token) return;
    placedRequestRef.current = request.token;
    const bounds = canvas.getBoundingClientRect();
    props.onAddAt(
      request.paletteId,
      screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      }),
    );
    props.onPlacementHandled();
  }, [props, screenToFlowPosition]);

  const commitHistory = useCallback(
    (next: RoadmapNode[] | undefined) => {
      if (!next) return;
      setNodes(next);
      props.onLayout(next);
    },
    [props, setNodes],
  );
  const duplicateSelection = useCallback(() => {
    if (props.selectedId) props.onDuplicate(props.selectedId);
  }, [props]);
  const deleteSelection = useCallback(() => {
    if (props.selectedId) props.onDelete(props.selectedId);
  }, [props]);
  const copySelection = useCallback(() => {
    if (props.selectedId) copiedNodeRef.current = props.selectedId;
  }, [props.selectedId]);
  const pasteSelection = useCallback(() => {
    if (copiedNodeRef.current) props.onDuplicate(copiedNodeRef.current);
  }, [props]);

  useShortcutHandler("roadmap.copy", copySelection, Boolean(props.selectedId));
  useShortcutHandler(
    "roadmap.paste",
    pasteSelection,
    () => props.canManage && Boolean(copiedNodeRef.current),
  );
  useShortcutHandler(
    "roadmap.duplicate",
    duplicateSelection,
    props.canManage && Boolean(props.selectedId),
  );
  useShortcutHandler(
    "roadmap.undo",
    useCallback(() => commitHistory(history.undo(nodesRef.current)), [commitHistory, history]),
    props.canManage,
  );
  useShortcutHandler(
    "roadmap.redo",
    useCallback(() => commitHistory(history.redo(nodesRef.current)), [commitHistory, history]),
    props.canManage,
  );
  useShortcutHandler(
    "roadmap.delete",
    deleteSelection,
    props.canManage && Boolean(props.selectedId),
  );

  const handleNodeChanges = useCallback(
    (changes: NodeChange<RoadmapNode>[]) => {
      onNodesChange(changes);
      if (changes.some((change) => change.type === "dimensions" && change.resizing === false)) {
        resizingRef.current = false;
        window.setTimeout(() => props.onLayout(nodesRef.current), 0);
      }
      if (
        !resizingRef.current &&
        changes.some((change) => change.type === "dimensions" && change.resizing === true)
      ) {
        resizingRef.current = true;
        history.capture(nodesRef.current);
      }
    },
    [history, onNodesChange, props],
  );

  const requestConnection = useCallback(
    (connection: Connection) => {
      const source = nodesRef.current.find((node) => node.id === connection.source)?.data;
      const target = nodesRef.current.find((node) => node.id === connection.target)?.data;
      if (!source?.endpoint || !target?.endpoint) return;
      const types = allowedRoadmapEdgeTypes(source.endpoint, target.endpoint, source.nodeKind);
      setPendingConnection({ connection, types });
      setEdges((current) =>
        addEdge({ ...connection, id: `pending:${crypto.randomUUID()}`, animated: false }, current),
      );
    },
    [setEdges],
  );

  return (
    <div
      ref={canvasRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden bg-charcoal-card"
      onDragOver={(event) => {
        if (!props.canManage) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const paletteId = event.dataTransfer.getData("application/x-misty-roadmap-node");
        if (!props.canManage || !paletteId) return;
        event.preventDefault();
        props.onAddAt(paletteId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}
    >
      <GraphToolbar
        canEdit={props.canManage}
        hasSelection={Boolean(props.selectedId)}
        onUndo={() => commitHistory(history.undo(nodesRef.current))}
        onRedo={() => commitHistory(history.redo(nodesRef.current))}
        onCopy={copySelection}
        onPaste={pasteSelection}
        onDuplicate={duplicateSelection}
        onDelete={deleteSelection}
        onFit={() => void fitView({ padding: 0.1, maxZoom: 1.08, duration: 260 })}
      />
      <ReactFlow<RoadmapNode, Edge>
        colorMode={resolvedTheme}
        nodes={nodes}
        edges={edges}
        nodeTypes={roadmapNodeTypes}
        nodesDraggable={props.canManage}
        nodesConnectable={props.canManage}
        onNodesChange={handleNodeChanges}
        onEdgesChange={onEdgesChange}
        onConnect={requestConnection}
        onNodeClick={(event, node) =>
          node.data.taskId
            ? props.onOpenTask(node.data.taskId)
            : props.onSelect(node.id, { x: event.clientX, y: event.clientY })
        }
        onPaneClick={() => props.onSelect("")}
        onEdgeClick={(event, edge) =>
          !edge.id.startsWith("task-edge:") &&
          props.onSelect(edge.id, { x: event.clientX, y: event.clientY })
        }
        onNodeDragStart={(_, node) =>
          node.data.canvasKind !== "task" && history.capture(nodesRef.current)
        }
        onNodeDragStop={(_, node) => {
          if (node.data.canvasKind === "task") return;
          const next = reparentRoadmapNode(node, nodesRef.current);
          setNodes(next);
          props.onLayout(next);
        }}
        defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
        onMoveEnd={(_, viewport) => writeViewport(viewportKey, viewport)}
        minZoom={0.25}
        maxZoom={1.8}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls
          showInteractive={false}
          className="!overflow-hidden !rounded-lg !border !border-charcoal-border/70 !bg-charcoal-bg !shadow-sm"
        />
        <MiniMap
          pannable
          zoomable
          className="!rounded-lg !border !border-charcoal-border/70 !bg-charcoal-bg !shadow-sm"
          nodeColor={(node) =>
            roadmapNodeColors[(node.data as RoadmapNodeData).color ?? "slate"].hex
          }
        />
      </ReactFlow>
      {pendingConnection ? (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-charcoal-bg "
          onMouseDown={() => cancelPending(setEdges, setPendingConnection)}
        >
          <div
            className="w-64 rounded-xl border border-charcoal-border bg-charcoal-card p-2 shadow-xl"
            role="dialog"
            aria-label="Choose connection type"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="mb-1 px-2 text-[10px] font-semibold text-cream-muted">Connection type</p>
            {pendingConnection.types.map((type) => (
              <Button
                key={type}
                variant="ghost"
                className="h-9 w-full justify-start text-xs"
                onClick={() => {
                  props.onConnect(pendingConnection.connection, type);
                  setPendingConnection(undefined);
                }}
              >
                {roadmapEdgeLabels[type]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function readViewport(key: string) {
  try {
    const viewport = JSON.parse(readDeploymentStorageItem(key) ?? "null") as
      { x: number; y: number; zoom: number } | undefined;
    return viewport ? { ...viewport, zoom: Math.max(0.35, viewport.zoom) } : undefined;
  } catch {
    return undefined;
  }
}
function writeViewport(key: string, viewport: { x: number; y: number; zoom: number }) {
  try {
    window.localStorage.setItem(deploymentStorageKey(key), JSON.stringify(viewport));
  } catch {
    /* optional */
  }
}
function cancelPending(
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
  setPending: React.Dispatch<
    React.SetStateAction<{ connection: Connection; types: SpaceRoadmapEdgeType[] } | undefined>
  >,
) {
  setEdges((current) => current.filter((edge) => !edge.id.startsWith("pending:")));
  setPending(undefined);
}
export type { RoadmapNode };

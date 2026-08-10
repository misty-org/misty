import type {
  SpaceRoadmapEdgeEndpoint,
  SpaceRoadmapEdgeType,
  SpaceRoadmapNodeColor,
  SpaceRoadmapNodeKind,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { Button, cn } from "@/shared/ui";
import {
  Handle,
  MarkerType,
  NodeResizer,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Circle,
  Flag,
  Gauge,
  Goal,
  ListTodo,
  NotebookPen,
  Scale,
} from "lucide-react";
import { roadmapEdgeLabels, roadmapIcon, roadmapNodeColors } from "./roadmapNodeCatalog";

export type RoadmapCanvasKind = "milestone" | "goal" | "support" | "task";
export type RoadmapNodeData = {
  canvasKind: RoadmapCanvasKind;
  label: string;
  subtitle: string;
  progress: number;
  status: string;
  color: SpaceRoadmapNodeColor;
  icon: string;
  endpoint?: SpaceRoadmapEdgeEndpoint;
  nodeKind?: SpaceRoadmapNodeKind;
  taskId?: string;
  goalId?: string;
  taskCount?: number;
  expanded?: boolean;
  targetDate?: string;
  onToggleGoal?: (goalId: string) => void;
};
export type RoadmapNode = Node<RoadmapNodeData>;

export const roadmapNodeTypes = {
  milestone: MilestoneNode,
  goal: GoalNode,
  support: SupportNode,
  task: TaskNode,
};

function MilestoneNode({ data, selected }: NodeProps<RoadmapNode>) {
  return (
    <div
      className={cn(
        "h-full w-full rounded-2xl border border-dashed border-charcoal-border/80 bg-charcoal-card p-4",
        selected && "ring-2 ring-charcoal-active/60",
      )}
    >
      <NodeResizer minWidth={320} minHeight={240} isVisible={selected} />
      <NodeHandles color={data.color} />
      <div className="flex items-center gap-2 pr-2">
        <Flag className="size-4 text-cream-muted" />
        <strong className="truncate text-sm">{data.label}</strong>
        <span className="ml-auto text-[10px] text-cream-muted">{data.progress}%</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-charcoal-card">
        <div className="h-full bg-charcoal-active" style={{ width: `${data.progress}%` }} />
      </div>
      {data.targetDate ? (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-cream-muted">
          <CalendarClock className="size-3" />
          {formatDate(data.targetDate)}
        </div>
      ) : null}
    </div>
  );
}

function GoalNode({ data, selected }: NodeProps<RoadmapNode>) {
  return (
    <div
      className={cn(
        "w-56 rounded-xl border border-charcoal-border/80 border-l-[3px] border-l-sage-fg bg-charcoal-card p-3 shadow-sm",
        selected && "ring-2 ring-sage-fg/50",
      )}
    >
      <NodeHandles color="blue" />
      <div className="flex items-start gap-2">
        <Goal className="mt-0.5 size-4 shrink-0 text-sage-fg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{data.label}</div>
          <div className="mt-1 text-[9px] uppercase text-cream-muted">
            Goal · {data.status.replace(/_/g, " ")}
          </div>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-charcoal-card">
        <div className="h-full bg-status-green" style={{ width: `${data.progress}%` }} />
      </div>
      <Button
        type="button"
        variant="ghost"
        className="nodrag mt-2 h-6 w-full justify-start gap-1 px-1 text-[10px] text-cream-muted"
        onClick={(event) => {
          event.stopPropagation();
          data.onToggleGoal?.(data.endpoint?.id ?? "");
        }}
      >
        {data.expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <ListTodo className="size-3" />
        {data.taskCount ?? 0} tasks
      </Button>
    </div>
  );
}

function SupportNode({ data, selected }: NodeProps<RoadmapNode>) {
  const Icon =
    data.nodeKind === "risk"
      ? AlertTriangle
      : data.nodeKind === "decision"
        ? Scale
        : data.nodeKind === "metric"
          ? Gauge
          : data.nodeKind === "note"
            ? NotebookPen
            : roadmapIcon(data.icon);
  const colors = roadmapNodeColors[data.color];
  return (
    <div
      className={cn(
        "w-52 rounded-xl border border-charcoal-border/80 border-l-[3px] bg-charcoal-card p-3 shadow-sm",
        colors.accent,
        selected && "ring-2 ring-current/40",
      )}
    >
      <NodeHandles color={data.color} />
      <div className="flex items-start gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", colors.soft)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-cream">{data.label}</div>
          <div className="mt-1 truncate text-[9px] uppercase text-cream-muted">{data.subtitle}</div>
        </div>
      </div>
      {data.targetDate ? (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-cream-muted">
          <CalendarClock className="size-3" />
          {formatDate(data.targetDate)}
        </div>
      ) : null}
    </div>
  );
}

function TaskNode({ data }: NodeProps<RoadmapNode>) {
  return (
    <div className="w-48 rounded-lg border border-charcoal-border/70 bg-charcoal-bg p-2.5 shadow-sm">
      <Handle type="source" position={Position.Left} className="!bg-cream-muted" />
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-4 place-items-center rounded-full border border-charcoal-border">
          <Circle className="size-2" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium">{data.label}</div>
          <div className="mt-1 text-[9px] uppercase text-cream-muted">
            Task · {data.status.replace(/_/g, " ")}
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeHandles({ color }: { color: SpaceRoadmapNodeColor }) {
  const style = { backgroundColor: roadmapNodeColors[color].hex };
  return (
    <>
      <Handle type="target" position={Position.Left} style={style} />
      <Handle type="source" position={Position.Right} style={style} />
    </>
  );
}

export function snapshotRoadmapNodes(
  snapshot: SpaceRoadmapSnapshot,
  expanded: Set<string>,
  onToggleGoal: (goalId: string) => void,
): RoadmapNode[] {
  const definitions = new Map(snapshot.node_definitions.map((item) => [item.id, item]));
  const milestones: RoadmapNode[] = snapshot.milestones.map((item) => ({
    id: item.id,
    type: "milestone",
    position: { x: item.position_x, y: item.position_y },
    style: { width: item.width, height: item.height },
    zIndex: 0,
    data: {
      canvasKind: "milestone",
      label: item.title,
      subtitle: "Milestone",
      progress: item.goal_total ? Math.round((item.goal_done / item.goal_total) * 100) : 0,
      status: item.status,
      color: "slate",
      icon: "flag",
      endpoint: { kind: "milestone", id: item.id },
      targetDate: item.target_date,
    },
  }));
  const goals: RoadmapNode[] = snapshot.goals.map((item) => ({
    id: item.id,
    type: "goal",
    parentId: item.milestone_id,
    position: { x: item.position_x, y: item.position_y },
    zIndex: 2,
    data: {
      canvasKind: "goal",
      label: item.title,
      subtitle: "Goal",
      progress: item.progress_percentage,
      status: item.status,
      color: "blue",
      icon: "goal",
      endpoint: { kind: "goal", id: item.id },
      taskCount: item.task_total,
      expanded: expanded.has(item.id),
      onToggleGoal,
      targetDate: item.target_date,
    },
  }));
  const support: RoadmapNode[] = snapshot.nodes.map((item) => {
    const definition = item.definition_id ? definitions.get(item.definition_id) : undefined;
    return {
      id: item.id,
      type: "support",
      parentId: item.milestone_id || undefined,
      position: { x: item.position_x, y: item.position_y },
      zIndex: 2,
      data: {
        canvasKind: "support",
        label: item.title,
        subtitle: definition?.name ?? (item.node_kind === "note" ? "Note / link" : item.node_kind),
        progress: 0,
        status: "",
        color: definition?.color ?? builtInColor(item.node_kind),
        icon: definition?.icon ?? "shapes",
        endpoint: { kind: "node", id: item.id },
        nodeKind: item.node_kind,
        targetDate: item.target_date,
      },
    };
  });
  const tasks: RoadmapNode[] = [];
  snapshot.goals.forEach((goal) => {
    if (!expanded.has(goal.id)) return;
    goal.tasks.forEach((task, index) =>
      tasks.push({
        id: `task:${goal.id}:${task.id}`,
        type: "task",
        parentId: goal.milestone_id,
        draggable: false,
        connectable: false,
        selectable: true,
        position: { x: goal.position_x + 270, y: goal.position_y + index * 64 },
        zIndex: 3,
        data: {
          canvasKind: "task",
          label: task.title,
          subtitle: "Task",
          progress: task.status === "done" ? 100 : 0,
          status: task.status,
          color: "slate",
          icon: "tasks",
          taskId: task.id,
          goalId: goal.id,
        },
      }),
    );
  });
  return [...milestones, ...goals, ...support, ...tasks];
}

export function snapshotRoadmapEdges(snapshot: SpaceRoadmapSnapshot, nodes: RoadmapNode[]): Edge[] {
  const edges: Edge[] = snapshot.edges.map((item) =>
    edgeView(item.id, item.source.id, item.target.id, item.edge_type, item.label),
  );
  nodes
    .filter((node) => node.data.canvasKind === "task" && node.data.goalId)
    .forEach((node) =>
      edges.push({
        id: `task-edge:${node.id}`,
        source: node.id,
        target: node.data.goalId!,
        type: "smoothstep",
        selectable: false,
        style: { strokeDasharray: "4 4", opacity: 0.55 },
        label: "contributes",
      }),
    );
  return edges;
}

function edgeView(
  id: string,
  source: string,
  target: string,
  type: SpaceRoadmapEdgeType,
  label: string,
): Edge {
  const directed = type !== "related";
  return {
    id,
    source,
    target,
    label: label || roadmapEdgeLabels[type],
    type: "smoothstep",
    markerEnd: directed ? { type: MarkerType.ArrowClosed } : undefined,
    animated: false,
    style:
      type === "related" || type === "documents"
        ? { strokeDasharray: "5 4" }
        : type === "blocks"
          ? { stroke: "#3E3E3E" }
          : type === "measures"
            ? { stroke: "#52825A" }
            : undefined,
    data: { type },
  };
}

export function reparentRoadmapNode(dragged: RoadmapNode, nodes: RoadmapNode[]) {
  if (dragged.data.canvasKind !== "goal" && dragged.data.canvasKind !== "support") return nodes;
  const currentParent = nodes.find((node) => node.id === dragged.parentId);
  const absoluteX = (currentParent?.position.x ?? 0) + dragged.position.x;
  const absoluteY = (currentParent?.position.y ?? 0) + dragged.position.y;
  const target = nodes
    .filter((node) => node.data.canvasKind === "milestone")
    .find((node) => {
      const width = Number(node.measured?.width ?? node.style?.width ?? 440);
      const height = Number(node.measured?.height ?? node.style?.height ?? 360);
      return (
        absoluteX + 104 >= node.position.x &&
        absoluteX + 104 <= node.position.x + width &&
        absoluteY + 32 >= node.position.y &&
        absoluteY + 32 <= node.position.y + height
      );
    });
  if (target?.id === dragged.parentId) return nodes;
  return nodes.map((node) =>
    node.id === dragged.id
      ? {
          ...node,
          parentId: target?.id,
          position: target
            ? { x: absoluteX - target.position.x, y: absoluteY - target.position.y }
            : { x: absoluteX, y: absoluteY },
        }
      : node,
  );
}

function builtInColor(kind: SpaceRoadmapNodeKind): SpaceRoadmapNodeColor {
  return kind === "risk"
    ? "rose"
    : kind === "decision"
      ? "violet"
      : kind === "metric"
        ? "emerald"
        : kind === "note"
          ? "amber"
          : "slate";
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

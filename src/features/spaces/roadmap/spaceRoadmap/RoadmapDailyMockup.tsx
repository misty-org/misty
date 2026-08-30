import type {
  SpaceRoadmapEdge,
  SpaceRoadmapGoal,
  SpaceRoadmapMilestone,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";
import { ListChecks, Sparkles } from "lucide-react";
import { useState } from "react";
import { RoadmapCanvas } from "./RoadmapCanvas";
import { RoadmapExecutionRail } from "./RoadmapExecutionRail";

const now = "2026-08-29T12:00:00Z";

export function RoadmapDailyMockup() {
  const [selectedId, setSelectedId] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const [expandedGoalIds, setExpandedGoalIds] = useState(new Set<string>());
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: string }>();

  const focusGoal = (id: string) => {
    setSelectedId(id);
    setFocusRequest({ id, token: crypto.randomUUID() });
  };

  return (
    <main className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg text-cream">
      <header className="flex min-h-14 items-center gap-3 border-b border-charcoal-border px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">Launch Misty for teams</h1>
            <span className="rounded-md bg-charcoal-card px-1.5 py-0.5 text-[10px] text-cream-muted">
              Concept preview
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-cream-muted">
            1/5 goals · 20% complete · demo data stays on this page
          </p>
        </div>
        {!railOpen ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-8 gap-1.5 px-2 text-xs"
            onClick={() => setRailOpen(true)}
          >
            <ListChecks className="size-3.5" />
            Daily plan
          </Button>
        ) : (
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-cream-muted">
            <Sparkles className="size-3.5 text-sage-fg" />
            One clear next action
          </div>
        )}
      </header>
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        {railOpen ? (
          <RoadmapExecutionRail
            snapshot={mockRoadmapSnapshot}
            selectedId={selectedId}
            onClose={() => setRailOpen(false)}
            onFocus={focusGoal}
            onOpenTask={() => undefined}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <RoadmapCanvas
            snapshot={mockRoadmapSnapshot}
            selectedId={selectedId}
            canManage={false}
            expandedGoalIds={expandedGoalIds}
            focusRequest={focusRequest}
            onPlacementHandled={() => undefined}
            onToggleGoal={(goalId) =>
              setExpandedGoalIds((current) => {
                const next = new Set(current);
                if (next.has(goalId)) next.delete(goalId);
                else next.add(goalId);
                return next;
              })
            }
            onOpenTask={() => undefined}
            onSelect={(id) => setSelectedId(id)}
            onLayout={() => undefined}
            onConnect={() => undefined}
            onDuplicate={() => undefined}
            onDelete={() => undefined}
            onAddAt={() => undefined}
          />
        </div>
      </div>
    </main>
  );
}

const milestones: SpaceRoadmapMilestone[] = [
  milestone("discover", "Prove the direction", 1, 30, 30, 1, 2),
  milestone("deliver", "Ship with confidence", 2, 410, 30, 0, 3),
];

const goals: SpaceRoadmapGoal[] = [
  goal("validate", "Validate the problem", "discover", 1, 42, 92, "done", 100, [
    task("interviews", "Summarize 12 customer interviews", "done", 1),
    task("signals", "Share the opportunity brief", "done", 2),
  ]),
  goal("prototype", "Build the working prototype", "discover", 2, 42, 290, "in_progress", 60, [
    task("journey", "Finish the first-run journey", "in_progress", 1),
    task("instrument", "Add activation analytics", "todo", 2),
    task("review", "Run an accessibility review", "todo", 3),
  ]),
  goal("beta", "Run the private beta", "deliver", 1, 42, 72, "not_started", 0, [
    task("recruit", "Recruit 20 design partners", "todo", 1),
    task("feedback", "Create the feedback cadence", "todo", 2),
  ]),
  goal("launch", "Open public access", "deliver", 2, 42, 238, "not_started", 0, [
    task("release", "Prepare release notes", "todo", 1),
    task("support", "Confirm support coverage", "todo", 2),
  ]),
  goal("learn", "Review week-one signals", "deliver", 3, 42, 404, "not_started", 0, [
    task("report", "Publish the week-one report", "todo", 1),
  ]),
];

const edges: SpaceRoadmapEdge[] = [
  edge("validate", "prototype", "enables"),
  edge("prototype", "beta", "enables"),
  edge("beta", "launch", "enables"),
  edge("launch", "learn", "enables"),
];

export const mockRoadmapSnapshot: SpaceRoadmapSnapshot = {
  roadmap: {
    id: "daily-preview",
    space_id: "preview-space",
    name: "Launch Misty for teams",
    description: "A dependency-aware launch plan.",
    graph_version: 1,
    created_by_user_id: "preview-user",
    audience_kind: "space",
    created_at: now,
    updated_at: now,
  },
  milestones,
  goals,
  nodes: [],
  node_definitions: [],
  edges,
  goal_total: 5,
  goal_done: 1,
  milestone_total: 2,
  milestone_done: 0,
  progress_percentage: 20,
};

function milestone(
  id: string,
  title: string,
  rank: number,
  x: number,
  y: number,
  goalDone: number,
  goalTotal: number,
): SpaceRoadmapMilestone {
  return {
    id,
    space_id: "preview-space",
    roadmap_id: "daily-preview",
    title,
    description: "",
    target_date: rank === 1 ? "2026-09-14" : "2026-10-05",
    rank,
    position_x: x,
    position_y: y,
    width: 340,
    height: 570,
    version: 1,
    goal_done: goalDone,
    goal_total: goalTotal,
    status: goalDone === goalTotal ? "done" : goalDone ? "in_progress" : "not_started",
    created_at: now,
    updated_at: now,
  };
}

function goal(
  id: string,
  title: string,
  milestoneId: string,
  rank: number,
  x: number,
  y: number,
  status: SpaceRoadmapGoal["status"],
  progress: number,
  tasks: SpaceTask[],
): SpaceRoadmapGoal {
  return {
    id,
    space_id: "preview-space",
    roadmap_id: "daily-preview",
    milestone_id: milestoneId,
    title,
    description: "",
    target_date: `2026-09-${String(8 + rank * 5).padStart(2, "0")}`,
    rank,
    position_x: x,
    position_y: y,
    version: 1,
    task_total: tasks.length,
    task_done: tasks.filter((item) => item.status === "done").length,
    progress_percentage: progress,
    status,
    tasks,
    created_at: now,
    updated_at: now,
  };
}

function task(id: string, title: string, status: SpaceTask["status"], rank: number): SpaceTask {
  return {
    id,
    space_id: "preview-space",
    task_number: rank,
    task_key: `DEMO-${rank}`,
    title,
    notes: "",
    status,
    priority: "medium",
    rank,
    due_timezone: "America/Los_Angeles",
    source_refs: [],
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

function edge(
  source: string,
  target: string,
  edgeType: SpaceRoadmapEdge["edge_type"],
): SpaceRoadmapEdge {
  return {
    id: `${source}:${target}`,
    space_id: "preview-space",
    roadmap_id: "daily-preview",
    source: { kind: "goal", id: source },
    target: { kind: "goal", id: target },
    edge_type: edgeType,
    label: "required first",
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

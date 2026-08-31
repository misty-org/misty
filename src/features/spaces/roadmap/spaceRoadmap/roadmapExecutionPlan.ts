import type {
  SpaceRoadmapEdge,
  SpaceRoadmapGoal,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";

export type RoadmapExecutionState = "done" | "ready" | "blocked";

export interface RoadmapExecutionItem {
  id: string;
  sequence: number;
  title: string;
  milestoneTitle: string;
  state: RoadmapExecutionState;
  progress: number;
  targetDate?: string;
  blockerIds: string[];
  blockerTitles: string[];
  remainingTasks: number;
  nextTask?: SpaceTask;
}

export interface RoadmapExecutionPlan {
  items: RoadmapExecutionItem[];
  next?: RoadmapExecutionItem;
  doneCount: number;
  readyCount: number;
  blockedCount: number;
  totalCount: number;
}

export function buildRoadmapExecutionPlan(snapshot: SpaceRoadmapSnapshot): RoadmapExecutionPlan {
  const goals = [...snapshot.goals].sort(compareGoals(snapshot));
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const prerequisites = prerequisiteMap(snapshot.edges, goalById);
  const ordered = topologicalGoalOrder(goals, prerequisites);
  const titleById = new Map(goals.map((goal) => [goal.id, goal.title]));
  const milestoneById = new Map(snapshot.milestones.map((item) => [item.id, item.title]));

  const items = ordered.map((goal, index): RoadmapExecutionItem => {
    const blockerIds = [...(prerequisites.get(goal.id) ?? [])].filter(
      (id) => !isGoalDone(goalById.get(id)),
    );
    const isDone = isGoalDone(goal);
    const nextTask = [...goal.tasks]
      .sort((left, right) => left.rank - right.rank)
      .find((task) => task.status !== "done" && task.status !== "canceled");
    return {
      id: goal.id,
      sequence: index + 1,
      title: goal.title,
      milestoneTitle: milestoneById.get(goal.milestone_id) ?? "Unassigned milestone",
      state: isDone ? "done" : blockerIds.length ? "blocked" : "ready",
      progress: goal.progress_percentage,
      targetDate: goal.target_date,
      blockerIds,
      blockerTitles: blockerIds.map((id) => titleById.get(id) ?? "Previous goal"),
      remainingTasks: goal.tasks.filter(
        (task) => task.status !== "done" && task.status !== "canceled",
      ).length,
      nextTask,
    };
  });
  const next = items.find((item) => item.state === "ready");

  return {
    items,
    next,
    doneCount: items.filter((item) => item.state === "done").length,
    readyCount: items.filter((item) => item.state === "ready").length,
    blockedCount: items.filter((item) => item.state === "blocked").length,
    totalCount: items.length,
  };
}

function isGoalDone(goal?: SpaceRoadmapGoal) {
  return goal?.status === "done" || (goal?.progress_percentage ?? 0) >= 100;
}

function prerequisiteMap(
  edges: SpaceRoadmapEdge[],
  goalById: Map<string, SpaceRoadmapGoal>,
): Map<string, Set<string>> {
  const prerequisites = new Map<string, Set<string>>(
    [...goalById.keys()].map((id) => [id, new Set<string>()]),
  );
  edges.forEach((edge) => {
    if (edge.source.kind !== "goal" || edge.target.kind !== "goal") return;
    if (!goalById.has(edge.source.id) || !goalById.has(edge.target.id)) return;
    if (edge.edge_type === "depends_on") {
      prerequisites.get(edge.source.id)?.add(edge.target.id);
    } else if (edge.edge_type === "blocks" || edge.edge_type === "enables") {
      prerequisites.get(edge.target.id)?.add(edge.source.id);
    }
  });
  return prerequisites;
}

function topologicalGoalOrder(
  goals: SpaceRoadmapGoal[],
  prerequisites: Map<string, Set<string>>,
): SpaceRoadmapGoal[] {
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const remaining = new Map(
    [...prerequisites].map(([id, values]) => [
      id,
      new Set([...values].filter((value) => goalById.has(value))),
    ]),
  );
  const ordered: SpaceRoadmapGoal[] = [];
  const consumed = new Set<string>();

  while (ordered.length < goals.length) {
    const ready = goals.filter(
      (goal) =>
        !consumed.has(goal.id) &&
        [...(remaining.get(goal.id) ?? [])].every((id) => consumed.has(id)),
    );
    const next = ready[0] ?? goals.find((goal) => !consumed.has(goal.id));
    if (!next) break;
    consumed.add(next.id);
    ordered.push(next);
  }
  return ordered;
}

function compareGoals(snapshot: SpaceRoadmapSnapshot) {
  const milestoneRank = new Map(snapshot.milestones.map((item) => [item.id, item.rank]));
  return (left: SpaceRoadmapGoal, right: SpaceRoadmapGoal) =>
    (milestoneRank.get(left.milestone_id) ?? Number.MAX_SAFE_INTEGER) -
      (milestoneRank.get(right.milestone_id) ?? Number.MAX_SAFE_INTEGER) ||
    left.rank - right.rank ||
    left.title.localeCompare(right.title);
}

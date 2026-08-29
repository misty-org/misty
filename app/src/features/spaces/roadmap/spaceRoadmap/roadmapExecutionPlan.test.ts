import { describe, expect, it } from "vitest";
import type {
  SpaceRoadmapEdge,
  SpaceRoadmapGoal,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { buildRoadmapExecutionPlan } from "./roadmapExecutionPlan";

describe("buildRoadmapExecutionPlan", () => {
  it("orders dependencies and identifies the next ready goal", () => {
    const snapshot = makeSnapshot(
      [goal("research", "Research", "done", 100), goal("launch", "Launch", "not_started", 0)],
      [edge("research", "launch", "enables")],
    );
    const plan = buildRoadmapExecutionPlan(snapshot);

    expect(plan.items.map((item) => item.id)).toEqual(["research", "launch"]);
    expect(plan.items.map((item) => item.state)).toEqual(["done", "ready"]);
    expect(plan.next?.id).toBe("launch");
  });

  it("treats the target of depends_on as the prerequisite", () => {
    const snapshot = makeSnapshot(
      [goal("publish", "Publish", "not_started", 0), goal("review", "Review", "in_progress", 50)],
      [edge("publish", "review", "depends_on")],
    );
    const plan = buildRoadmapExecutionPlan(snapshot);

    expect(plan.items.map((item) => item.id)).toEqual(["review", "publish"]);
    expect(plan.items.find((item) => item.id === "publish")?.state).toBe("blocked");
    expect(plan.items.find((item) => item.id === "publish")?.blockerTitles).toEqual(["Review"]);
  });

  it("falls back to stable ordering when dependencies contain a cycle", () => {
    const snapshot = makeSnapshot(
      [goal("a", "A", "not_started", 0), goal("b", "B", "not_started", 0)],
      [edge("a", "b", "blocks"), edge("b", "a", "blocks")],
    );
    const plan = buildRoadmapExecutionPlan(snapshot);

    expect(plan.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(plan.blockedCount).toBe(2);
    expect(plan.next).toBeUndefined();
  });
});

function goal(
  id: string,
  title: string,
  status: SpaceRoadmapGoal["status"],
  progress: number,
): SpaceRoadmapGoal {
  return {
    id,
    title,
    status,
    progress_percentage: progress,
    space_id: "space",
    roadmap_id: "roadmap",
    milestone_id: "milestone",
    description: "",
    rank: id === "a" || id === "research" || id === "publish" ? 1 : 2,
    position_x: 0,
    position_y: 0,
    version: 1,
    task_total: 0,
    task_done: 0,
    tasks: [],
    created_at: "2026-08-29T00:00:00Z",
    updated_at: "2026-08-29T00:00:00Z",
  };
}

function edge(
  source: string,
  target: string,
  edgeType: SpaceRoadmapEdge["edge_type"],
): SpaceRoadmapEdge {
  return {
    id: `${source}:${target}`,
    space_id: "space",
    roadmap_id: "roadmap",
    source: { kind: "goal", id: source },
    target: { kind: "goal", id: target },
    edge_type: edgeType,
    label: "",
    version: 1,
    created_at: "2026-08-29T00:00:00Z",
    updated_at: "2026-08-29T00:00:00Z",
  };
}

function makeSnapshot(goals: SpaceRoadmapGoal[], edges: SpaceRoadmapEdge[]): SpaceRoadmapSnapshot {
  return {
    roadmap: {
      id: "roadmap",
      space_id: "space",
      name: "Launch",
      description: "",
      graph_version: 1,
      created_by_user_id: "user",
      audience_kind: "space",
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z",
    },
    milestones: [
      {
        id: "milestone",
        space_id: "space",
        roadmap_id: "roadmap",
        title: "Launch",
        description: "",
        rank: 1,
        position_x: 0,
        position_y: 0,
        width: 400,
        height: 400,
        version: 1,
        goal_total: goals.length,
        goal_done: goals.filter((item) => item.status === "done").length,
        status: "in_progress",
        created_at: "2026-08-29T00:00:00Z",
        updated_at: "2026-08-29T00:00:00Z",
      },
    ],
    goals,
    nodes: [],
    node_definitions: [],
    edges,
    goal_total: goals.length,
    goal_done: goals.filter((item) => item.status === "done").length,
    milestone_total: 1,
    milestone_done: 0,
    progress_percentage: 0,
  };
}

import { readDeploymentStorageItem } from "@/api/deployment/api";
import type {
  SpaceRoadmapEdgeEndpoint,
  SpaceRoadmapMilestone,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { RoadmapNode } from "./RoadmapCanvas";

export function normalizeRoadmapSnapshot(snapshot: SpaceRoadmapSnapshot): SpaceRoadmapSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes ?? [],
    node_definitions: snapshot.node_definitions ?? [],
    edges: (snapshot.edges ?? []).map((edge) => ({
      ...edge,
      source: edge.source ?? { kind: "goal", id: edge.source_goal_id ?? "" },
      target: edge.target ?? { kind: "goal", id: edge.target_goal_id ?? "" },
      edge_type: (edge.edge_type as string) === "dependency" ? "depends_on" : edge.edge_type,
    })),
  };
}

export function readExpandedGoals(key: string) {
  try {
    const value = JSON.parse(readDeploymentStorageItem(key) ?? "[]") as unknown;
    return new Set(
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function readBoolean(key: string) {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "false") === true;
  } catch {
    return false;
  }
}

export function milestoneAt(
  milestones: SpaceRoadmapMilestone[],
  position: { x: number; y: number },
) {
  return milestones.find(
    (milestone) =>
      position.x >= milestone.position_x &&
      position.x <= milestone.position_x + milestone.width &&
      position.y >= milestone.position_y &&
      position.y <= milestone.position_y + milestone.height,
  );
}

export function roadmapEndpoint(
  snapshot: SpaceRoadmapSnapshot,
  id: string | null,
): SpaceRoadmapEdgeEndpoint | undefined {
  if (!id) return undefined;
  if (snapshot.milestones.some((item) => item.id === id)) return { kind: "milestone", id };
  if (snapshot.goals.some((item) => item.id === id)) return { kind: "goal", id };
  if (snapshot.nodes.some((item) => item.id === id)) return { kind: "node", id };
  return undefined;
}

export function applyRoadmapLayout(
  snapshot: SpaceRoadmapSnapshot,
  nodes: RoadmapNode[],
  graphVersion: number,
): SpaceRoadmapSnapshot {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    ...snapshot,
    roadmap: { ...snapshot.roadmap, graph_version: graphVersion },
    milestones: snapshot.milestones.map((item) => {
      const node = byId.get(item.id);
      return node
        ? {
            ...item,
            position_x: node.position.x,
            position_y: node.position.y,
            width: Number(node.measured?.width ?? node.style?.width ?? item.width),
            height: Number(node.measured?.height ?? node.style?.height ?? item.height),
          }
        : item;
    }),
    goals: snapshot.goals.map((item) => {
      const node = byId.get(item.id);
      return node
        ? {
            ...item,
            milestone_id: node.parentId ?? item.milestone_id,
            position_x: node.position.x,
            position_y: node.position.y,
          }
        : item;
    }),
    nodes: snapshot.nodes.map((item) => {
      const node = byId.get(item.id);
      return node
        ? {
            ...item,
            milestone_id: node.parentId,
            position_x: node.position.x,
            position_y: node.position.y,
          }
        : item;
    }),
  };
}

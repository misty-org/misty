import type {
  SpaceAgendaSnapshot,
  SpaceRoadmap,
  SpaceRoadmapEdge,
  SpaceRoadmapGoal,
  SpaceRoadmapMilestone,
  SpaceRoadmapMutationResult,
  SpaceRoadmapNode,
  SpaceRoadmapNodeDefinition,
  SpaceRoadmapSnapshot,
} from "@/models/interfaces/features/spaces/plannerExpansionTypes";

type SpaceRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;

export function createSpacePlannerExpansionApi(request: SpaceRequest) {
  const roadmapPath = (spaceId: string, roadmapId = "") =>
    `/spaces/${encodeURIComponent(spaceId)}/roadmaps${
      roadmapId ? `/${encodeURIComponent(roadmapId)}` : ""
    }`;

  return {
    agenda: (spaceId: string, from: string, to: string) =>
      request<SpaceAgendaSnapshot>(
        `/spaces/${encodeURIComponent(spaceId)}/agenda?${new URLSearchParams({ from, to })}`,
      ),
    roadmaps: (spaceId: string) => request<{ roadmaps: SpaceRoadmap[] }>(roadmapPath(spaceId)),
    roadmapNodeDefinitions: (spaceId: string) =>
      request<{ node_definitions: SpaceRoadmapNodeDefinition[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/roadmap-node-definitions`,
      ),
    createRoadmapNodeDefinition: (
      spaceId: string,
      definition: Partial<SpaceRoadmapNodeDefinition>,
    ) =>
      request<SpaceRoadmapNodeDefinition>(
        `/spaces/${encodeURIComponent(spaceId)}/roadmap-node-definitions`,
        { method: "POST", body: JSON.stringify(definition) },
      ),
    updateRoadmapNodeDefinition: (spaceId: string, definition: SpaceRoadmapNodeDefinition) =>
      request<SpaceRoadmapNodeDefinition>(
        `/spaces/${encodeURIComponent(spaceId)}/roadmap-node-definitions/${encodeURIComponent(definition.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...definition, expected_version: definition.version }),
        },
      ),
    archiveRoadmapNodeDefinition: (spaceId: string, definition: SpaceRoadmapNodeDefinition) =>
      request<void>(
        `/spaces/${encodeURIComponent(spaceId)}/roadmap-node-definitions/${encodeURIComponent(definition.id)}?expected_version=${definition.version}`,
        { method: "DELETE" },
      ),
    createRoadmap: (spaceId: string, name: string, description = "") =>
      request<SpaceRoadmapSnapshot>(roadmapPath(spaceId), {
        method: "POST",
        body: JSON.stringify({ name, description }),
      }),
    roadmap: (spaceId: string, roadmapId: string) =>
      request<SpaceRoadmapSnapshot>(roadmapPath(spaceId, roadmapId)),
    updateRoadmap: (spaceId: string, roadmap: SpaceRoadmap) =>
      request<SpaceRoadmap>(roadmapPath(spaceId, roadmap.id), {
        method: "PATCH",
        body: JSON.stringify({
          name: roadmap.name,
          description: roadmap.description,
          expected_version: roadmap.graph_version,
        }),
      }),
    archiveRoadmap: (spaceId: string, roadmap: SpaceRoadmap) =>
      request<SpaceRoadmapMutationResult>(
        `${roadmapPath(spaceId, roadmap.id)}?expected_version=${roadmap.graph_version}`,
        { method: "DELETE" },
      ),
    createRoadmapMilestone: (
      spaceId: string,
      roadmapId: string,
      milestone: Partial<SpaceRoadmapMilestone>,
      expectedVersion: number,
    ) =>
      request<{ milestone: SpaceRoadmapMilestone; graph_version: number }>(
        `${roadmapPath(spaceId, roadmapId)}/milestones`,
        {
          method: "POST",
          body: JSON.stringify({ ...milestone, expected_version: expectedVersion }),
        },
      ),
    updateRoadmapMilestone: (
      spaceId: string,
      milestone: SpaceRoadmapMilestone,
      expectedVersion: number,
    ) =>
      request<{ milestone: SpaceRoadmapMilestone; graph_version: number }>(
        `${roadmapPath(spaceId, milestone.roadmap_id)}/milestones/${encodeURIComponent(milestone.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...milestone, expected_version: expectedVersion }),
        },
      ),
    archiveRoadmapMilestone: (
      spaceId: string,
      milestone: SpaceRoadmapMilestone,
      expectedVersion: number,
    ) =>
      request<SpaceRoadmapMutationResult>(
        `${roadmapPath(spaceId, milestone.roadmap_id)}/milestones/${encodeURIComponent(
          milestone.id,
        )}?expected_version=${expectedVersion}`,
        { method: "DELETE" },
      ),
    createRoadmapGoal: (
      spaceId: string,
      roadmapId: string,
      goal: Partial<SpaceRoadmapGoal>,
      expectedVersion: number,
    ) =>
      request<{ goal: SpaceRoadmapGoal; graph_version: number }>(
        `${roadmapPath(spaceId, roadmapId)}/goals`,
        {
          method: "POST",
          body: JSON.stringify({ ...goal, expected_version: expectedVersion }),
        },
      ),
    updateRoadmapGoal: (
      spaceId: string,
      goal: SpaceRoadmapGoal,
      expectedVersion: number,
      completeManually?: boolean,
    ) =>
      request<{ goal: SpaceRoadmapGoal; graph_version: number }>(
        `${roadmapPath(spaceId, goal.roadmap_id)}/goals/${encodeURIComponent(goal.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...goal,
            complete_manually: completeManually,
            expected_version: expectedVersion,
          }),
        },
      ),
    archiveRoadmapGoal: (spaceId: string, goal: SpaceRoadmapGoal, expectedVersion: number) =>
      request<SpaceRoadmapMutationResult>(
        `${roadmapPath(spaceId, goal.roadmap_id)}/goals/${encodeURIComponent(
          goal.id,
        )}?expected_version=${expectedVersion}`,
        { method: "DELETE" },
      ),
    replaceRoadmapGoalTasks: (
      spaceId: string,
      goal: SpaceRoadmapGoal,
      taskIds: string[],
      expectedVersion: number,
    ) =>
      request<SpaceRoadmapMutationResult>(
        `${roadmapPath(spaceId, goal.roadmap_id)}/goals/${encodeURIComponent(goal.id)}/tasks`,
        {
          method: "PUT",
          body: JSON.stringify({ task_ids: taskIds, expected_version: expectedVersion }),
        },
      ),
    createRoadmapNode: (
      spaceId: string,
      roadmapId: string,
      node: Partial<SpaceRoadmapNode>,
      expectedVersion: number,
    ) =>
      request<{ node: SpaceRoadmapNode; graph_version: number }>(
        `${roadmapPath(spaceId, roadmapId)}/nodes`,
        {
          method: "POST",
          body: JSON.stringify({ ...node, expected_version: expectedVersion }),
        },
      ),
    updateRoadmapNode: (spaceId: string, node: SpaceRoadmapNode, expectedVersion: number) =>
      request<{ node: SpaceRoadmapNode; graph_version: number }>(
        `${roadmapPath(spaceId, node.roadmap_id)}/nodes/${encodeURIComponent(node.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...node, expected_version: expectedVersion }),
        },
      ),
    archiveRoadmapNode: (spaceId: string, node: SpaceRoadmapNode, expectedVersion: number) =>
      request<SpaceRoadmapMutationResult>(
        `${roadmapPath(spaceId, node.roadmap_id)}/nodes/${encodeURIComponent(node.id)}?expected_version=${expectedVersion}`,
        { method: "DELETE" },
      ),
    saveRoadmapEdge: (
      spaceId: string,
      roadmapId: string,
      edge: Partial<SpaceRoadmapEdge>,
      expectedVersion: number,
    ) =>
      request<{ edge: SpaceRoadmapEdge; graph_version: number }>(
        `${roadmapPath(spaceId, roadmapId)}/edges${
          edge.id ? `/${encodeURIComponent(edge.id)}` : ""
        }`,
        {
          method: edge.id ? "PATCH" : "POST",
          body: JSON.stringify({ ...edge, expected_version: expectedVersion }),
        },
      ),
    deleteRoadmapEdge: (spaceId: string, edge: SpaceRoadmapEdge, expectedVersion: number) =>
      request<SpaceRoadmapMutationResult>(
        `${roadmapPath(spaceId, edge.roadmap_id)}/edges/${encodeURIComponent(
          edge.id,
        )}?expected_version=${expectedVersion}`,
        { method: "DELETE" },
      ),
    updateRoadmapLayout: (
      spaceId: string,
      roadmapId: string,
      layout: {
        milestones: Array<
          Pick<SpaceRoadmapMilestone, "id" | "position_x" | "position_y" | "width" | "height">
        >;
        goals: Array<Pick<SpaceRoadmapGoal, "id" | "milestone_id" | "position_x" | "position_y">>;
        nodes?: Array<Pick<SpaceRoadmapNode, "id" | "milestone_id" | "position_x" | "position_y">>;
      },
      expectedVersion: number,
    ) =>
      request<SpaceRoadmapMutationResult>(`${roadmapPath(spaceId, roadmapId)}/layout`, {
        method: "PATCH",
        body: JSON.stringify({ ...layout, expected_version: expectedVersion }),
      }),
  };
}

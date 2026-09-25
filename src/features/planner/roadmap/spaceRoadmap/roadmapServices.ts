import { parseMethodParams, type MistyAppSDK, type MistyServerMethod } from "@misty/sdk";
import type { createSpacePlannerExpansionApi } from "@/api/spaces/planner";
import {
  sdkRoadmap,
  sdkRoadmapSnapshot,
  sdkMilestone,
  sdkGoal,
  sdkNode,
  sdkDefinition,
  sdkEdge,
} from "./sdkRoadmapValues";

export type PlannerRoadmapServices = Omit<
  ReturnType<typeof createSpacePlannerExpansionApi>,
  "agenda"
>;

export function createSDKRoadmapServices(misty: MistyAppSDK): PlannerRoadmapServices {
  // The UI's partial drafts are checked against each named contract before RPC.
  const call = <M extends MistyServerMethod>(method: M, params: unknown) =>
    misty.server.call(method, parseMethodParams(method, params));
  return {
    async roadmaps(spaceID) {
      const result = await call("roadmaps.list", { path: { spaceID } });
      return { roadmaps: (result.roadmaps ?? []).map(sdkRoadmap) };
    },
    async roadmap(spaceID, roadmapID) {
      return sdkRoadmapSnapshot(await call("roadmaps.get", { path: { spaceID, roadmapID } }));
    },
    async createRoadmap(spaceID, name, description = "") {
      return sdkRoadmapSnapshot(
        await call("roadmaps.create", { path: { spaceID }, body: { name, description } }),
      );
    },
    async updateRoadmap(spaceID, roadmap) {
      return sdkRoadmap(
        await call("roadmaps.update", {
          path: { spaceID, roadmapID: roadmap.id },
          body: {
            name: roadmap.name,
            description: roadmap.description,
            expected_version: roadmap.graph_version,
          },
        }),
      );
    },
    archiveRoadmap: (spaceID, roadmap) =>
      call("roadmaps.delete", {
        path: { spaceID, roadmapID: roadmap.id },
        query: { expected_version: roadmap.graph_version },
      }),
    async roadmapNodeDefinitions(spaceID) {
      const result = await call("roadmaps.nodeDefinitions.list", { path: { spaceID } });
      return { node_definitions: (result.node_definitions ?? []).map(sdkDefinition) };
    },
    async createRoadmapNodeDefinition(spaceID, definition) {
      return sdkDefinition(
        await call("roadmaps.nodeDefinitions.create", { path: { spaceID }, body: definition }),
      );
    },
    async updateRoadmapNodeDefinition(spaceID, definition) {
      return sdkDefinition(
        await call("roadmaps.nodeDefinitions.update", {
          path: { spaceID, definitionID: definition.id },
          body: { ...definition, expected_version: definition.version },
        }),
      );
    },
    archiveRoadmapNodeDefinition: (spaceID, definition) =>
      call("roadmaps.nodeDefinitions.delete", {
        path: { spaceID, definitionID: definition.id },
        query: { expected_version: definition.version },
      }),
    async createRoadmapMilestone(spaceID, roadmapID, milestone, expectedVersion) {
      const result = await call("roadmaps.milestones.create", {
        path: { spaceID, roadmapID },
        body: { ...milestone, expected_version: expectedVersion },
      });
      return { ...result, milestone: sdkMilestone(result.milestone) };
    },
    async updateRoadmapMilestone(spaceID, milestone, expectedVersion) {
      const result = await call("roadmaps.milestones.update", {
        path: { spaceID, roadmapID: milestone.roadmap_id, milestoneID: milestone.id },
        body: { ...milestone, expected_version: expectedVersion },
      });
      return { ...result, milestone: sdkMilestone(result.milestone) };
    },
    archiveRoadmapMilestone: (spaceID, milestone, expectedVersion) =>
      call("roadmaps.milestones.delete", {
        path: { spaceID, roadmapID: milestone.roadmap_id, milestoneID: milestone.id },
        query: { expected_version: expectedVersion },
      }),
    async createRoadmapGoal(spaceID, roadmapID, goal, expectedVersion) {
      const result = await call("roadmaps.goals.create", {
        path: { spaceID, roadmapID },
        body: { ...goal, expected_version: expectedVersion },
      });
      return { ...result, goal: sdkGoal(result.goal) };
    },
    async updateRoadmapGoal(spaceID, goal, expectedVersion, completeManually) {
      const result = await call("roadmaps.goals.update", {
        path: { spaceID, roadmapID: goal.roadmap_id, goalID: goal.id },
        body: { ...goal, expected_version: expectedVersion, complete_manually: completeManually },
      });
      return { ...result, goal: sdkGoal(result.goal) };
    },
    archiveRoadmapGoal: (spaceID, goal, expectedVersion) =>
      call("roadmaps.goals.delete", {
        path: { spaceID, roadmapID: goal.roadmap_id, goalID: goal.id },
        query: { expected_version: expectedVersion },
      }),
    replaceRoadmapGoalTasks: (spaceID, goal, taskIds, expectedVersion) =>
      call("roadmaps.goals.setTasks", {
        path: { spaceID, roadmapID: goal.roadmap_id, goalID: goal.id },
        body: { task_ids: taskIds, expected_version: expectedVersion },
      }),
    async createRoadmapNode(spaceID, roadmapID, node, expectedVersion) {
      const result = await call("roadmaps.nodes.create", {
        path: { spaceID, roadmapID },
        body: { ...node, expected_version: expectedVersion },
      });
      return { ...result, node: sdkNode(result.node) };
    },
    async updateRoadmapNode(spaceID, node, expectedVersion) {
      const result = await call("roadmaps.nodes.update", {
        path: { spaceID, roadmapID: node.roadmap_id, nodeID: node.id },
        body: { ...node, expected_version: expectedVersion },
      });
      return { ...result, node: sdkNode(result.node) };
    },
    archiveRoadmapNode: (spaceID, node, expectedVersion) =>
      call("roadmaps.nodes.delete", {
        path: { spaceID, roadmapID: node.roadmap_id, nodeID: node.id },
        query: { expected_version: expectedVersion },
      }),
    async saveRoadmapEdge(spaceID, roadmapID, edge, expectedVersion) {
      const body = { ...edge, expected_version: expectedVersion };
      const result = edge.id
        ? await call("roadmaps.edges.update", {
            path: { spaceID, roadmapID, edgeID: edge.id },
            body,
          })
        : await call("roadmaps.edges.create", { path: { spaceID, roadmapID }, body });
      return { ...result, edge: sdkEdge(result.edge) };
    },
    deleteRoadmapEdge: (spaceID, edge, expectedVersion) =>
      call("roadmaps.edges.delete", {
        path: { spaceID, roadmapID: edge.roadmap_id, edgeID: edge.id },
        query: { expected_version: expectedVersion },
      }),
    updateRoadmapLayout: (spaceID, roadmapID, layout, expectedVersion) =>
      call("roadmaps.layout.update", {
        path: { spaceID, roadmapID },
        body: { ...layout, expected_version: expectedVersion },
      }),
  };
}

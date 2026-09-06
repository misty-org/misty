import {
  MistySDKError,
  type SpaceRoadmap as SDKRoadmap,
  type SpaceRoadmapMilestone as SDKMilestone,
  type SpaceRoadmapGoal as SDKGoal,
  type SpaceRoadmapNode as SDKNode,
  type SpaceRoadmapNodeDefinition as SDKDefinition,
  type SpaceRoadmapEdge as SDKEdge,
  type SpaceRoadmapSnapshot as SDKSnapshot,
} from "@misty/sdk";
import type {
  SpaceRoadmap,
  SpaceRoadmapMilestone,
  SpaceRoadmapGoal,
  SpaceRoadmapNode,
  SpaceRoadmapNodeDefinition,
  SpaceRoadmapFieldDefinition,
  SpaceRoadmapEdge,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { plannerEnum, plannerRecord } from "../../planner/plannerValues";
import { plannerTask } from "../../planner/spaceTasks/taskServices";

export function sdkRoadmap(value: SDKRoadmap): SpaceRoadmap {
  return {
    ...value,
    audience_kind: plannerEnum(value.audience_kind, ["space", "conversation"]),
    archived_at: value.archived_at ?? undefined,
  };
}
export function sdkMilestone(value: SDKMilestone): SpaceRoadmapMilestone {
  return {
    ...value,
    target_date: value.target_date ?? undefined,
    status: plannerEnum(value.status, ["not_started", "in_progress", "done"]),
  };
}
export function sdkGoal(value: SDKGoal): SpaceRoadmapGoal {
  return {
    ...value,
    target_date: value.target_date ?? undefined,
    manual_completed_at: value.manual_completed_at ?? undefined,
    status: plannerEnum(value.status, ["not_started", "in_progress", "done"]),
    tasks: (value.tasks ?? []).map(plannerTask),
  };
}
export function sdkNode(value: SDKNode): SpaceRoadmapNode {
  const fields: SpaceRoadmapNode["field_values"] = {};
  for (const [key, item] of Object.entries(plannerRecord(value.field_values))) {
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean")
      throw new MistySDKError("invalid_response", "Unsupported roadmap field value.");
    fields[key] = item;
  }
  return {
    ...value,
    target_date: value.target_date ?? undefined,
    archived_at: value.archived_at ?? undefined,
    node_kind: plannerEnum(value.node_kind, ["risk", "decision", "metric", "note", "custom"]),
    field_values: fields,
  };
}
function sdkField(value: unknown): SpaceRoadmapFieldDefinition {
  const item = plannerRecord(value);
  if (
    typeof item.id !== "string" ||
    typeof item.label !== "string" ||
    (item.archived !== undefined && typeof item.archived !== "boolean")
  )
    throw new MistySDKError("invalid_response", "Invalid roadmap field definition.");
  let options: string[] | undefined;
  if (item.options != null) {
    if (
      !Array.isArray(item.options) ||
      !item.options.every((value): value is string => typeof value === "string")
    )
      throw new MistySDKError("invalid_response", "Invalid roadmap field options.");
    options = item.options;
  }
  return {
    id: item.id,
    label: item.label,
    type: plannerEnum(item.type, [
      "short_text",
      "long_text",
      "number",
      "date",
      "url",
      "select",
      "checkbox",
    ]),
    options,
    archived: item.archived,
  };
}
export function sdkDefinition(value: SDKDefinition): SpaceRoadmapNodeDefinition {
  if (value.field_schema !== null && !Array.isArray(value.field_schema))
    throw new MistySDKError("invalid_response", "Invalid roadmap field schema.");
  return {
    ...value,
    archived_at: value.archived_at ?? undefined,
    color: plannerEnum(value.color, [
      "slate",
      "blue",
      "cyan",
      "emerald",
      "amber",
      "orange",
      "rose",
      "violet",
    ]),
    field_schema: (value.field_schema ?? []).map(sdkField),
  };
}
export function sdkEdge(value: SDKEdge): SpaceRoadmapEdge {
  return {
    ...value,
    source: {
      ...value.source,
      kind: plannerEnum(value.source.kind, ["milestone", "goal", "node"]),
    },
    target: {
      ...value.target,
      kind: plannerEnum(value.target.kind, ["milestone", "goal", "node"]),
    },
    edge_type: plannerEnum(value.edge_type === "dependency" ? "depends_on" : value.edge_type, [
      "depends_on",
      "blocks",
      "enables",
      "contributes_to",
      "measures",
      "documents",
      "related",
    ]),
  };
}
export function sdkRoadmapSnapshot(value: SDKSnapshot): SpaceRoadmapSnapshot {
  return {
    ...value,
    roadmap: sdkRoadmap(value.roadmap),
    milestones: (value.milestones ?? []).map(sdkMilestone),
    goals: (value.goals ?? []).map(sdkGoal),
    nodes: (value.nodes ?? []).map(sdkNode),
    node_definitions: (value.node_definitions ?? []).map(sdkDefinition),
    edges: (value.edges ?? []).map(sdkEdge),
  };
}

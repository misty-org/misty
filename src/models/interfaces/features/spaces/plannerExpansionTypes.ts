import type { SpaceTask } from "./types";

export type SpaceAgendaEntryKind = "task" | "event" | "goal" | "milestone" | "roadmap_node";

export interface SpaceAgendaEntry {
  id: string;
  kind: SpaceAgendaEntryKind;
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  status?: string;
  source_id?: string;
  task_id?: string;
  roadmap_id?: string;
  milestone_id?: string;
  goal_id?: string;
  roadmap_node_id?: string;
  roadmap_node_kind?: SpaceRoadmapNodeKind;
  definition_id?: string;
  meeting_url?: string;
  location?: string;
  external_event_id?: string;
}

export interface SpaceAgendaSnapshot {
  entries: SpaceAgendaEntry[];
}

export interface SpaceRoadmap {
  id: string;
  space_id: string;
  name: string;
  description: string;
  graph_version: number;
  created_by_user_id: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SpaceRoadmapMilestone {
  id: string;
  space_id: string;
  roadmap_id: string;
  title: string;
  description: string;
  target_date?: string;
  rank: number;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  version: number;
  goal_total: number;
  goal_done: number;
  status: "not_started" | "in_progress" | "done";
  created_at: string;
  updated_at: string;
}

export interface SpaceRoadmapGoal {
  id: string;
  space_id: string;
  roadmap_id: string;
  milestone_id: string;
  title: string;
  description: string;
  target_date?: string;
  rank: number;
  position_x: number;
  position_y: number;
  manual_completed_at?: string;
  manual_completed_by_user_id?: string;
  version: number;
  task_total: number;
  task_done: number;
  progress_percentage: number;
  status: "not_started" | "in_progress" | "done";
  tasks: SpaceTask[];
  created_at: string;
  updated_at: string;
}

export interface SpaceRoadmapEdge {
  id: string;
  space_id: string;
  roadmap_id: string;
  source: SpaceRoadmapEdgeEndpoint;
  target: SpaceRoadmapEdgeEndpoint;
  source_goal_id?: string;
  target_goal_id?: string;
  edge_type: SpaceRoadmapEdgeType;
  label: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export type SpaceRoadmapEndpointKind = "milestone" | "goal" | "node";
export type SpaceRoadmapEdgeType =
  "depends_on" | "blocks" | "enables" | "contributes_to" | "measures" | "documents" | "related";

export interface SpaceRoadmapEdgeEndpoint {
  kind: SpaceRoadmapEndpointKind;
  id: string;
}

export type SpaceRoadmapFieldType =
  "short_text" | "long_text" | "number" | "date" | "url" | "select" | "checkbox";

export interface SpaceRoadmapFieldDefinition {
  id: string;
  label: string;
  type: SpaceRoadmapFieldType;
  options?: string[];
  archived?: boolean;
}

export interface SpaceRoadmapNodeDefinition {
  id: string;
  space_id: string;
  name: string;
  description: string;
  icon: string;
  color: SpaceRoadmapNodeColor;
  agenda_visible: boolean;
  field_schema: SpaceRoadmapFieldDefinition[];
  version: number;
  created_by_user_id: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export type SpaceRoadmapNodeKind = "risk" | "decision" | "metric" | "note" | "custom";
export type SpaceRoadmapNodeColor =
  "slate" | "blue" | "cyan" | "emerald" | "amber" | "orange" | "rose" | "violet";

export interface SpaceRoadmapNode {
  id: string;
  space_id: string;
  roadmap_id: string;
  milestone_id?: string;
  definition_id?: string;
  node_kind: SpaceRoadmapNodeKind;
  title: string;
  description: string;
  target_date?: string;
  position_x: number;
  position_y: number;
  field_values: Record<string, string | number | boolean>;
  version: number;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SpaceRoadmapSnapshot {
  roadmap: SpaceRoadmap;
  milestones: SpaceRoadmapMilestone[];
  goals: SpaceRoadmapGoal[];
  nodes: SpaceRoadmapNode[];
  node_definitions: SpaceRoadmapNodeDefinition[];
  edges: SpaceRoadmapEdge[];
  goal_total: number;
  goal_done: number;
  milestone_total: number;
  milestone_done: number;
  progress_percentage: number;
}

export interface SpaceRoadmapMutationResult {
  graph_version: number;
}

export type SpaceRoadmapSaveState = "saved" | "saving" | "unsaved" | "conflict";

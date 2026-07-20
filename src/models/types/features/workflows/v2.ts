import type {
  ContentRef,
  ContentSection,
  ContentCitation,
  ContentPage,
  WorkflowCapabilityRequirement,
  WorkflowRetryPolicy,
  WorkflowErrorPolicy,
  WorkflowNodeV2,
  WorkflowEdgeV2,
  WorkflowDependency,
  WorkflowDefinitionV2,
  WorkflowNodeDescriptor,
} from "@/models/interfaces/features/workflows/v2";

export type WorkflowRisk = "read" | "write" | "destructive";

export type WorkflowExecutionLocation = "cloud" | "device" | "either";

export type JSONSchema = Record<string, unknown>;

export type WorkflowBinding =
  { sourceNode: string; sourcePort: string } | { inputPath: string } | { literal: unknown };

export type WorkflowNodeKind =
  | "manual_trigger"
  | "chat_trigger"
  | "cron_trigger"
  | "file_changes"
  | "library_changes"
  | "message_trigger"
  | "connector_trigger"
  | "task_change_trigger"
  | "changed_files"
  | "source_query"
  | "read_content"
  | "read_metadata"
  | "task_query"
  | "calendar_query"
  | "transform"
  | "for_each"
  | "condition"
  | "switch"
  | "join"
  | "debounce"
  | "delay"
  | "call_workflow"
  | "agent_task"
  | "create_document"
  | "write_library_artifact"
  | "notify_private"
  | "post_reply"
  | "update_metadata"
  | "memory_write"
  | "create_task"
  | "update_task"
  | "delete_resource"
  | "change_permissions"
  | "exact_tool"
  | "http_request";

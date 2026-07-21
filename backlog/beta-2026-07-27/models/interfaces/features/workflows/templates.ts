import { createWorkflowNode, workflowNodeRegistry } from "@/features/workflows/v2";
import type { WorkflowNodeKind } from "@/models/types/features/workflows/v2";
import type {
  WorkflowCapabilityRequirement,
  WorkflowDefinitionV2,
  WorkflowEdgeV2,
  WorkflowNodeV2,
} from "@/models/interfaces/features/workflows/v2";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinitionV2;
}

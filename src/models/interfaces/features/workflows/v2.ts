import type {
  WorkflowRisk,
  WorkflowExecutionLocation,
  JSONSchema,
  WorkflowBinding,
  WorkflowNodeKind,
} from "@/models/types/features/workflows/v2";

export interface ContentRef {
  sourceKind: string;
  providerId: string;
  resourceId: string;
  version?: string;
  fingerprint?: string;
  displayName: string;
  mimeType?: string;
  locator?: string;
  permissionScope: string;
}

export interface ContentSection {
  kind: string;
  locator: string;
  text?: string;
  mediaDataUrl?: string;
}

export interface ContentCitation {
  content: ContentRef;
  kind: string;
  locator: string;
  excerpt?: string;
}

export interface ContentPage {
  content: ContentRef;
  sections: ContentSection[];
  citations: ContentCitation[];
  nextCursor?: string;
  truncated: boolean;
  sourceChanged: boolean;
}

export interface WorkflowCapabilityRequirement {
  capability: string;
  risk: WorkflowRisk;
  scopes?: Record<string, string>;
}

export interface WorkflowRetryPolicy {
  maxAttempts: 3;
  cooldownSeconds: 60;
}

export interface WorkflowErrorPolicy {
  mode: "fail" | "continue" | "collect";
  acceptsPartial?: boolean;
}

export interface WorkflowNodeV2 {
  id: string;
  kind: WorkflowNodeKind;
  kindVersion: 1;
  label: string;
  config: Record<string, unknown>;
  inputs?: Record<string, WorkflowBinding>;
  outputSchema: JSONSchema;
  retry: WorkflowRetryPolicy;
  errors: WorkflowErrorPolicy;
  position?: { x: number; y: number };
}

export interface WorkflowEdgeV2 {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface WorkflowDependency {
  workflowId: string;
  versionId: string;
  checksum: string;
}

export interface WorkflowDefinitionV2 {
  formatVersion: typeof workflowFormatVersion;
  inputs: JSONSchema;
  outputs: JSONSchema;
  capabilities: WorkflowCapabilityRequirement[];
  nodes: WorkflowNodeV2[];
  edges: WorkflowEdgeV2[];
  dependencies: WorkflowDependency[];
}

export interface WorkflowNodeDescriptor {
  kind: WorkflowNodeKind;
  label: string;
  group: "Triggers" | "Data" | "Control" | "Intelligence" | "Actions";
  capability: string;
  risk: WorkflowRisk;
  location: WorkflowExecutionLocation;
  defaultConfig: Record<string, unknown>;
  defaultOutputSchema: JSONSchema;
}
import type { workflowFormatVersion } from "@/features/workflows/v2";

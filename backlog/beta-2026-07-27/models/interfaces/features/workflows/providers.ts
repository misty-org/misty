import type { WorkflowNodeKind, WorkflowRisk } from "@/models/types/features/workflows/v2";

import type { ProviderTier, ProviderAuth } from "@/models/types/features/workflows/providers";

export interface ProviderDefinition {
  id: string;
  name: string;
  tier: ProviderTier;
  auth: ProviderAuth;
  color: string;
  description: string;
  capabilities: string[];
}

export interface ProviderNodeTemplate {
  id: string;
  providerId: string;
  label: string;
  description: string;
  category: "Triggers" | "Files" | "Integrations" | "Actions";
  kind: WorkflowNodeKind;
  risk: WorkflowRisk;
  capability: string;
  operation: string;
  defaults?: Record<string, unknown>;
}

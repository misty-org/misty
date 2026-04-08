import type { WorkflowNodeKind, WorkflowRisk } from "@/models/types/features/workflows/v2";

import type {
  ProviderDefinition,
  ProviderNodeTemplate,
} from "@/models/interfaces/features/workflows/providers";

export type ProviderTier = "full" | "content" | "meeting";

export type ProviderAuth = "oauth" | "oauth_install";

import type { ProviderConfigMode } from "@/models/types/services/misty-api";
import type {
  ProviderConfigStep,
  ProviderWorkflow,
  ProviderWorkflowOption,
} from "@/models/interfaces/services/misty-api";

import type { TokenField } from "@/models/types/pages/Providers/providerUtils";

export interface ProviderConnectionLike {
  mode: ProviderConfigMode;
  providerType: string;
  parameters: Record<string, string>;
  step: ProviderConfigStep | null;
}

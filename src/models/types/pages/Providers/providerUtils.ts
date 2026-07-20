import type { ProviderConfigMode } from "@/models/types/services/misty-api";
import type {
  ProviderConfigStep,
  ProviderWorkflow,
  ProviderWorkflowOption,
} from "@/models/interfaces/services/misty-api";

import type { ProviderConnectionLike } from "@/models/interfaces/pages/Providers/providerUtils";

export type TokenField = {
  key: string;
  value: string;
  sensitive: boolean;
};

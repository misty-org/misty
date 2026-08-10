import type { ProviderWorkflow } from "@/services/misty/model/misty-api";
import type { ProviderConnectionSession } from "../../stores/providers/interfaces/useProvidersStore";

export interface ProviderConnectionDialogProps {
  session: ProviderConnectionSession;
  workflows: ProviderWorkflow[];
  onClose: () => void;
  onChooseProvider: (providerType: string) => void;
  onName: (name: string) => void;
  onParameter: (key: string, value: string) => void;
  onAdvance: () => void;
  onSubmit: (polling?: boolean) => void;
  onOpenAuthorize: () => void;
}

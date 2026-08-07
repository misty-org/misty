import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui";
import { Alert, AlertDescription, AlertTitle } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import type {
  ProviderWorkflow,
  ProviderWorkflowOption,
} from "@/models/interfaces/services/misty-api";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { providerOptionsForConnection } from "@/pages/Providers/providerUtils";
import type { ProviderConnectionSession } from "@/models/interfaces/stores/providers/useProvidersStore";
import { ProviderLogo } from "@/pages/Providers/components/ProviderLogo";
import { EmptyState } from "@/ui";

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

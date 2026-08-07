import { Button } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import type {
  ProviderWorkflow,
  ProviderWorkflowOption,
  CloudConfigPaths,
  RemoteEditDraft,
} from "@/models/interfaces/services/misty-api";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { prettyLabel } from "@/lib/format";
import { isSecretKey, parseTokenFields } from "@/pages/Providers/providerUtils";

export interface RemoteConfigFormProps {
  draft: RemoteEditDraft;
  configKeys: string[];
  workflow: ProviderWorkflow | null;
  configPaths: CloudConfigPaths | null;
  tokenVisible: boolean;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
}

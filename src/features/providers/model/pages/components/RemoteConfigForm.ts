import type { CloudConfigPaths, ProviderWorkflow, RemoteEditDraft } from "@/native/contracts";

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

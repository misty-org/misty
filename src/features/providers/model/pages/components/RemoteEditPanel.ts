import type { CloudConfigPaths, ProviderWorkflow, RemoteEditDraft } from "@/native/contracts";

export interface RemoteEditPanelProps {
  draft: RemoteEditDraft | null;
  configPaths: CloudConfigPaths | null;
  configKeys: string[];
  workflow: ProviderWorkflow | null;
  dirty: boolean;
  loadingRemoteName: string | null;
  working: boolean;
  tokenVisible: boolean;
  validRemoteName: boolean;
  stale: boolean;
  serviceError: string | null;
  feedbackError: string | null;
  feedbackMessage: string | null;
  onDraftName: (name: string) => void;
  onConfigField: (key: string, value: string) => void;
  onTokenField: (key: string, value: string) => void;
  onTokenVisible: (visible: boolean) => void;
  onSave: () => void;
  onDelete: (name: string) => void;
  onReload: () => void;
  onTest: () => void;
}

import { Alert, AlertDescription, AlertTitle } from "@/ui";
import { Button } from "@/ui";
import { Skeleton } from "@/ui";
import type {
  ProviderWorkflow,
  RcloneConfigPaths,
  RemoteEditDraft,
} from "@/models/interfaces/services/misty-api";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { Panel, PanelHeader } from "@/pages/Providers/components/ProviderPanel";
import { RemoteConfigForm } from "@/pages/Providers/components/RemoteConfigForm";
import { RemoteEditActions } from "@/pages/Providers/components/RemoteEditActions";
import { EmptyState, ErrorState } from "@/ui";
import { StatusBadge } from "@/ui";

export interface RemoteEditPanelProps {
  draft: RemoteEditDraft | null;
  configPaths: RcloneConfigPaths | null;
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

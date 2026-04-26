import { Button } from "@/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui";
import { remoteDisplayName } from "@/stores/backend";
import type { ProviderRemote } from "@/models/interfaces/services/misty-api";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { IconButton } from "@/ui";
import { Panel, PanelHeader } from "@/pages/Providers/components/ProviderPanel";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { ProviderLogo } from "@/pages/Providers/components/ProviderLogo";
import { EmptyState, ErrorState } from "@/ui";
import { StatusBadge } from "@/ui";

export interface RemoteListPanelProps {
  remotes: ProviderRemote[];
  selectedRemoteName: string | null;
  loading: boolean;
  serviceError: string | null;
  working: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onSelectRemote: (name: string) => void;
  onRepair: (remote: ProviderRemote) => void;
  onDisconnect: (name: string) => void;
}

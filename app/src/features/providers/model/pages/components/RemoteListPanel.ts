import type { ProviderRemote } from "@/services/misty/model/misty-api";

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

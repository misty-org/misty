import { Button } from "@/ui";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";

export interface RemoteEditActionsProps {
  working: boolean;
  dirty: boolean;
  validRemoteName: boolean;
  stale: boolean;
  onSave: () => void;
  onDelete: () => void;
  onTest: () => void;
}

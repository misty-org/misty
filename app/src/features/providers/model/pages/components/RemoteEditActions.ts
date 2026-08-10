export interface RemoteEditActionsProps {
  working: boolean;
  dirty: boolean;
  validRemoteName: boolean;
  stale: boolean;
  onSave: () => void;
  onDelete: () => void;
  onTest: () => void;
}

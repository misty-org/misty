import { SettingsWorkspace } from "@/features/settings";
import { WorkspaceOverlay } from "@/shared/ui";
type OverlayProps = {
  open: boolean;
  onClose: () => void;
};
export function SettingsOverlay(props: OverlayProps) {
  return (
    <WorkspaceOverlay {...props} ariaLabel="Settings">
      <SettingsWorkspace presentation="overlay" onClose={props.onClose} />
    </WorkspaceOverlay>
  );
}

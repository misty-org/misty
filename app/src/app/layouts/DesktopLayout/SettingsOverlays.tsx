import { ProvidersWorkspace } from "@/features/providers";
import { SettingsWorkspace } from "@/features/settings";
import { WorkspaceOverlay } from "@/shared/ui/workspace-overlay";

type OverlayProps = { open: boolean; onClose: () => void };

export function SettingsOverlay(props: OverlayProps) {
  return (
    <WorkspaceOverlay {...props} ariaLabel="Settings">
      <SettingsWorkspace presentation="overlay" onClose={props.onClose} />
    </WorkspaceOverlay>
  );
}

export function RemotesOverlay(props: OverlayProps) {
  return (
    <WorkspaceOverlay {...props} ariaLabel="Remotes">
      <ProvidersWorkspace presentation="overlay" onClose={props.onClose} />
    </WorkspaceOverlay>
  );
}

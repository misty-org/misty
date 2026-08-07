import SettingsWorkspace from "@/pages/Settings/desktop";
import { ProvidersWorkspace } from "@/pages/Providers/desktop";
import { WorkspaceOverlay } from "./WorkspaceOverlay";

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

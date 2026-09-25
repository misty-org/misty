import { ConnectedStoragePanel } from "@/features/providers";
import { SettingsWorkspace } from "@/features/settings";
import { isWebBuild } from "@/shared/platform/buildTarget";
import { DesktopAccessState } from "@/shared/ui";
import { WorkspaceOverlay } from "@/shared/ui/workspace-overlay";

type OverlayProps = { open: boolean; onClose: () => void };

export function SettingsOverlay(props: OverlayProps) {
  return (
    <WorkspaceOverlay {...props} ariaLabel="Settings">
      {isWebBuild ? (
        <DesktopAccessState feature="Settings" />
      ) : (
        <SettingsWorkspace presentation="overlay" onClose={props.onClose} />
      )}
    </WorkspaceOverlay>
  );
}

export function RemotesOverlay(props: OverlayProps) {
  if (!props.open) return null;
  if (!isWebBuild) return <ConnectedStoragePanel onClose={props.onClose} />;
  return (
    <WorkspaceOverlay {...props} ariaLabel="Remotes">
      <DesktopAccessState feature="Connected storage" />
    </WorkspaceOverlay>
  );
}

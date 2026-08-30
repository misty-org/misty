import { ProvidersWorkspace } from "@/features/providers";
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
  return (
    <WorkspaceOverlay {...props} ariaLabel="Remotes">
      {isWebBuild ? (
        <DesktopAccessState feature="Connected storage" />
      ) : (
        <ProvidersWorkspace presentation="overlay" onClose={props.onClose} />
      )}
    </WorkspaceOverlay>
  );
}

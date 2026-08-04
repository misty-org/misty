import type { CSSProperties } from "react";
import SettingsWorkspace from "@/pages/Settings/desktop";
import { ProvidersWorkspace } from "@/pages/Providers/desktop";
import { ActivityFeed } from "./ActivityFeed";
import { WorkspaceOverlay } from "./WorkspaceOverlay";

type OverlayProps = { open: boolean; style: CSSProperties; onClose: () => void };

export function ActivityOverlay(props: OverlayProps) {
  return (
    <WorkspaceOverlay {...props} ariaLabel="Activity">
      <ActivityFeed onClose={props.onClose} />
    </WorkspaceOverlay>
  );
}

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

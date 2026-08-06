import FilesPage from "@/features/explorer";
import ExtensionsPage from "@/pages/Extensions";
import TransfersPage from "@/pages/Transfers";
import DesktopAgentsPage from "@/pages/Agents/desktop";
import type { SpacesTab } from "@/stores/spaces/useSpacesTabsStore";

export function SpacesWorkspaceSurface(props: { tab: Exclude<SpacesTab, { kind: "space" }> }) {
  if (props.tab.kind === "file-manager") {
    // The tab title is the workspace's name, so a renamed tab carries through
    // to the workspace chip in the Explorer sidebar.
    return (
      <FilesPage embedded workspaceId={props.tab.workspaceId} workspaceTitle={props.tab.title} />
    );
  }
  if (props.tab.kind === "agents") {
    return <DesktopAgentsPage />;
  }
  if (props.tab.kind === "extensions") return <ExtensionsPage embedded />;
  return <TransfersPage />;
}

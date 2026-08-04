import FilesPage from "@/features/explorer";
import ExtensionsPage from "@/pages/Extensions";
import TransfersPage from "@/pages/Transfers";
import DesktopAgentsPage from "@/pages/Agents/desktop";
import type { SpacesTab } from "@/stores/spaces/useSpacesTabsStore";

export function SpacesWorkspaceSurface(props: { tab: Exclude<SpacesTab, { kind: "space" }> }) {
  if (props.tab.kind === "file-manager") {
    return <FilesPage embedded workspaceId={props.tab.workspaceId} workspaceTitle="File Manager" />;
  }
  if (props.tab.kind === "agents") {
    return <DesktopAgentsPage />;
  }
  if (props.tab.kind === "extensions") return <ExtensionsPage embedded />;
  return <TransfersPage />;
}

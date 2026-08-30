import { AgentsPage } from "@/features/agents";
import { BrowserWorkspace } from "@/features/browser";
import { DeveloperWorkspace } from "@/features/developer-workspace";
import FilesPage from "@/features/files/explorer";
import { MarketplacePage } from "@/features/marketplace";
import { InboxWorkspace } from "@/features/inbox";
import { TerminalWorkspace } from "@/features/terminal";
import { TransfersWorkspacePanel } from "@/features/transfers";
import { socialProviderFromRoute, SpaceSectionView } from "@/features/spaces";
import type { WorkspaceTab } from "@/features/workspace";
import { isWebBuild } from "@/shared/platform/buildTarget";
import { cn, ComingSoonSurface, DesktopAccessState } from "@/shared/ui";
import { Plus } from "lucide-react";

/** Static surface for a workspace tab that isn't the currently-routed one. */
export function WorkspaceSurface({ tab }: { tab: WorkspaceTab }) {
  if (isWebBuild) {
    const desktopFeature = desktopFeatureForSurface(tab.surfaceId);
    if (desktopFeature) return <DesktopAccessState feature={desktopFeature} />;
  }

  switch (tab.surfaceId) {
    case "home":
      return <ComingSoonSurface feature="Home" />;
    case "inbox":
      return <InboxWorkspace />;
    case "browser":
      return <BrowserWorkspace tab={tab} />;
    case "terminal":
      return <TerminalWorkspace tab={tab} />;
    case "code":
      return <DeveloperWorkspace tab={tab} />;
    case "files":
      return <FilesPage embedded workspaceId={tab.id} workspaceTitle={tab.title} />;
    case "transfers":
      return <TransfersWorkspacePanel workspaceId={tab.id} />;
    case "agents":
      return <AgentsPage />;
    case "marketplace":
      return <MarketplacePage embedded />;
    case "space":
      return <SpacePane tab={tab} />;
  }
}

export function desktopFeatureForSurface(surfaceId: WorkspaceTab["surfaceId"]): string | null {
  if (surfaceId === "browser") return "Browser";
  if (surfaceId === "terminal") return "Terminal";
  if (surfaceId === "code") return "Code";
  if (surfaceId === "files") return "Files";
  if (surfaceId === "transfers") return "Transfers";
  return null;
}

/**
 * A Space section in any pane.
 *
 * Space content used to come from the router outlet, which meant only the one
 * focused pane could show it — every other pane went blank. The section reads
 * its Space and section from the tab's own route instead, so the same Space
 * can be open in as many panes as you like.
 */
function SpacePane({ tab }: { tab: WorkspaceTab }) {
  const route = parseSpaceTabRoute(tab.route);
  if (!route) return <div className="h-full bg-charcoal-bg" />;
  return (
    <SpaceSectionView
      spaceId={route.spaceId}
      section={route.section}
      studioKind={route.studioKind}
      workspaceTabId={tab.id}
    />
  );
}

/** `/spaces/:spaceId/:section/:studioKind` — the shape `SpaceDetail` normalises to. */
export function parseSpaceTabRoute(
  route: string,
): { spaceId: string; section: string; studioKind: string } | null {
  const parts = route.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (parts[0] !== "spaces" || !parts[1]) return null;
  const section = parts[2] ?? "";
  return {
    spaceId: safeDecode(parts[1]),
    section,
    studioKind: section === "social" ? socialProviderFromRoute(route) : (parts[3] ?? ""),
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function EmptyWorkspacePane({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg text-cream-muted">
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-charcoal-border",
          "bg-charcoal-card px-4 py-2 text-sm hover:border-charcoal-active hover:text-cream",
        )}
        onClick={onOpen}
      >
        <Plus size={16} /> Open a workspace or tool
      </button>
    </div>
  );
}

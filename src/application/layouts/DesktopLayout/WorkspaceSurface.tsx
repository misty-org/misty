import { DiscoverPage } from "@/features/marketplace";
import { OfficialAppRuntimePage } from "@/features/apps";
import { canonicalSpaceRoute, socialProviderFromRoute, SpaceSectionView } from "@/features/spaces";
import { WorkspaceTabRouteScope, type WorkspaceTab } from "@/features/workspace";
import { cn, ComingSoonSurface, ErrorState } from "@/shared/ui";
import { Plus } from "lucide-react";

/** Static surface for a workspace tab that isn't the currently-routed one. */
export function WorkspaceSurface({ tab, active = true }: { tab: WorkspaceTab; active?: boolean }) {
  const scopedTab =
    tab.surfaceId === "space" ? { ...tab, route: canonicalSpaceRoute(tab.route) } : tab;
  return (
    <WorkspaceTabRouteScope tab={scopedTab}>
      <WorkspaceSurfaceContent tab={scopedTab} active={active} />
    </WorkspaceTabRouteScope>
  );
}

function WorkspaceSurfaceContent({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  switch (tab.surfaceId) {
    case "home":
      return <ComingSoonSurface feature="Home" />;
    case "official-app":
      return <OfficialAppRuntimePage appId={appIdFromTab(tab)} tab={tab} active={active} />;
    case "marketplace":
      return <DiscoverPage embedded />;
    case "space":
      return <SpacePane tab={tab} />;
    default:
      return <LegacyAppSurface title={tab.title} />;
  }
}

function LegacyAppSurface({ title }: { title: string }) {
  return (
    <ErrorState
      className="h-full"
      title={`${title || "This App"} moved to Discover`}
      description="This saved tab used Misty’s retired built-in runtime. Close it and open the App from Discover."
    />
  );
}

function appIdFromTab(tab: WorkspaceTab): string {
  if (tab.groupKey.startsWith("app:")) return tab.groupKey.slice(4);
  const parts = tab.route.split(/[?#]/)[0].split("/").filter(Boolean);
  return parts[0] === "apps" ? safeDecode(parts[1] ?? "") : "";
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
  if (!route)
    return (
      <ErrorState
        className="h-full"
        title="This Space view could not be opened"
        description="Choose a Space view from the sidebar to replace this invalid tab route."
      />
    );
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
  const canonicalRoute = canonicalSpaceRoute(route);
  const parts = canonicalRoute.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (parts[0] !== "spaces" || !parts[1]) return null;
  const section = parts[2] ?? "";
  return {
    spaceId: safeDecode(parts[1]),
    section,
    studioKind: section === "social" ? socialProviderFromRoute(canonicalRoute) : (parts[3] ?? ""),
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
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted",
        )}
        onClick={onOpen}
      >
        <Plus size={16} /> Open a workspace or tool
      </button>
    </div>
  );
}

import { spaceWorkspaceToolFromRoute, type WorkspaceView } from "@/features/app-windows";
import { workspaceAppIcon } from "@/features/app-windows";
import { appIconStrokeWidth, BrandIcon, brandIconAsset, cn } from "@/shared/ui";
import { type LucideIcon } from "lucide-react";
import { providerFromRoute } from "@/features/browser";
import { websiteIntegrations } from "@/features/browser";
import { DestinationIcon } from "./NavigatorDestinationIcon";
function getViewAppId(tab: WorkspaceView | undefined): string {
  if (!tab) return "";
  if (tab.surfaceId === "space") {
    const tool = spaceWorkspaceToolFromRoute(tab.route);
    return tool === "space" ? "home" : tool;
  }
  return tab.surfaceId;
}
function getViewIcon(tab: WorkspaceView | undefined, fallback: LucideIcon): LucideIcon {
  return (
    workspaceAppIcon(getViewAppId(tab), tab?.surfaceId === "space" ? "space" : "app") ?? fallback
  );
}
export function ViewIcon({
  tab,
  icon: DefaultIcon,
  size = 16,
  isActive = false,
}: {
  tab?: WorkspaceView;
  icon: LucideIcon;
  size?: number;
  isActive?: boolean;
}) {
  const appId = getViewAppId(tab);
  if (brandIconAsset(appId)) return <BrandIcon brand={appId} size={size} />;
  const provider =
    tab && (appId === "social" || appId === "chat") ? providerFromRoute(tab.route, "chat") : null;
  if (provider)
    return (
      <span className="inline-flex shrink-0">
        <BrandIcon brand={provider} size={size} />
      </span>
    );
  const website = tab
    ? new URL(tab.route, "https://misty.local").searchParams.get("provider")
    : null;
  if (
    website &&
    ["journal", "library"].includes(appId) &&
    Object.prototype.hasOwnProperty.call(websiteIntegrations, website)
  )
    return (
      <span className="inline-flex shrink-0">
        <BrandIcon brand={website} size={size} />
      </span>
    );
  const section = tab ? new URL(tab.route, "https://misty.local").searchParams.get("view") : null;
  if (
    tab &&
    (!website || website === "misty") &&
    section &&
    ["notes", "drawings", "explorer", "recent", "favorites", "collections", "deleted"].includes(
      section,
    )
  )
    return (
      <span className="inline-flex shrink-0 [&_svg]:!size-4">
        <DestinationIcon
          appId={appId}
          item={{
            id: section,
            label: section,
            route: tab.route,
          }}
        />
      </span>
    );
  const ResolvedIcon = getViewIcon(tab, DefaultIcon);
  return (
    <ResolvedIcon
      size={size}
      className={cn("shrink-0", isActive ? "text-cream-bright" : "text-cream-muted")}
      strokeWidth={appIconStrokeWidth}
    />
  );
}

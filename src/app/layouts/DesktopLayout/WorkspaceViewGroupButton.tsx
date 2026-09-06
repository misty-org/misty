import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import {
  parseBrowserViewState,
  spaceWorkspaceToolFromRoute,
  type WorkspaceView,
} from "@/features/workspace";
import { workspaceAppIcon } from "@/features/workspace/WorkspaceAppIcon";
import { appIconStrokeWidth, BrandIcon, brandIconAsset, cn, Spinner } from "@/shared/ui";
import { VenetianMask, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { providerFromRoute } from "@/features/webviews/providers";
import { websiteIntegrations } from "@/features/webviews/websiteIntegrations";
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
  const [faviconFailed, setFaviconFailed] = useState(false);
  const isBrowser = getViewAppId(tab) === "browser";
  const browserState = isBrowser && tab ? parseBrowserViewState(tab.state) : null;
  const isLoading = useBrowserRuntimeStore((state) =>
    tab?.id ? Boolean(state.loading[tab.id]) : false,
  );
  const faviconUrl = browserState?.faviconUrl;
  useEffect(() => setFaviconFailed(false), [faviconUrl]);
  if (browserState?.private && !isLoading) {
    return (
      <VenetianMask
        className={cn("shrink-0", isActive ? "text-cream-bright" : "text-cream-muted")}
        size={size}
        strokeWidth={2}
        aria-label="Private tab"
      />
    );
  }
  if (isBrowser && isLoading) {
    return (
      <Spinner
        label={false}
        className={isActive ? "text-cream-bright" : "text-cream-muted"}
        style={{ width: size, height: size }}
      />
    );
  }
  if (isBrowser && faviconUrl && !faviconFailed) {
    return (
      <img
        alt=""
        className={cn(
          "shrink-0 select-none rounded-sm object-contain [image-rendering:auto]",
          size === 13 ? "size-3.5" : "size-4",
        )}
        decoding="async"
        draggable={false}
        key={faviconUrl}
        onError={() => setFaviconFailed(true)}
        src={faviconUrl}
      />
    );
  }
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
    ["planner", "journal", "library"].includes(appId) &&
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
    [
      "notes",
      "drawings",
      "tasks",
      "agenda",
      "roadmaps",
      "explorer",
      "recent",
      "favorites",
      "collections",
      "albums",
      "deleted",
    ].includes(section)
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
export function workspaceTabDropIndex(
  paneTabs: WorkspaceView[],
  movingTabId: string,
  targetTabId: string,
): number {
  const targetIndex = paneTabs.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex < 0) return paneTabs.length;
  const sourceIndex = paneTabs.findIndex((tab) => tab.id === movingTabId);
  return sourceIndex >= 0 && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
}

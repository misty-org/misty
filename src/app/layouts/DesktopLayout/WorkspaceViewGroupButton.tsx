import { Renameable } from "@/features/navigation-names/Renameable";
import {
  groupNameKey,
  navigationName,
  tabNameKey,
  useNavigationName,
  useNavigationNames,
} from "@/features/navigation-names/store";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import type { NavigatorAppId } from "@/features/workspace";
import {
  dockLeaves,
  parseBrowserViewState,
  spaceWorkspaceToolFromRoute,
  useWorkspaceStore,
  type WorkspaceGroupKey,
  type WorkspaceSurfaceId,
  type WorkspaceView,
} from "@/features/workspace";
import { workspaceAppIcon } from "@/features/workspace/WorkspaceAppIcon";
import { reorderIds, usePointerReorder } from "@/shared/hooks/usePointerReorder";
import {
  appIconStrokeWidth,
  BrandIcon,
  brandIconAsset,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  MenuTrigger,
  Pressable,
  Spinner,
} from "@/shared/ui";
import { Blocks, ChevronDown, VenetianMask, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { providerFromRoute, providers } from "@/features/webviews/providers";
import {
  websiteIntegrations,
  type WebsiteIntegrationId,
} from "@/features/webviews/websiteIntegrations";
import { DestinationIcon } from "./NavigatorDestinationIcon";
export interface TabGroup {
  instanceId?: string;
  key: string;
  surfaceId: WorkspaceSurfaceId;
  label: string;
  contextLabel?: string;
  tabs: WorkspaceView[];
  storeGroupKey: WorkspaceGroupKey | null;
}
interface Props {
  group: TabGroup;
  icon?: LucideIcon | null;
  activeTabId: string | null;
  canClose: boolean;
  canCloseTab?: (tab: WorkspaceView) => boolean;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  onOpen: (tab: WorkspaceView) => void;
  onClose: (tab: WorkspaceView) => void;
  onMoveView: (tabId: string, dropIndex: number) => void;
  paneViews?: WorkspaceView[];
}
function getViewAppId(tab: WorkspaceView | undefined): string {
  if (!tab) return "";
  if (tab.surfaceId === "official-app" || tab.surfaceId === "extension") {
    const parts = tab.route.split(/[?#]/)[0].split("/").filter(Boolean);
    const appId = parts[0] === "apps" ? parts[1] : tab.groupKey.replace(/^app:/, "");
    return appId;
  }
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
    tab && (appId === "inbox" || appId === "social" || appId === "chat")
      ? providerFromRoute(tab.route, appId === "inbox" ? "inbox" : "chat")
      : null;
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
    ["planner", "journal", "library", "files"].includes(appId) &&
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
          appId={appId as NavigatorAppId}
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
export function WorkspaceTabGroupButton({
  group,
  icon,
  activeTabId,
  canClose,
  canCloseTab,
  lastUsedTabByGroup,
  onOpen,
  onClose,
  onMoveView: onMoveTab,
  paneViews: paneTabs,
}: Props) {
  // Persisted workspace tabs can outlive the surface that originally created
  // them. Never let missing presentation metadata crash the entire workspace.
  useNavigationNames();
  const nameKey = groupNameKey(
    group.instanceId ?? group.tabs[0]?.groupInstanceId ?? `group:${group.tabs[0]?.id ?? group.key}`,
  );
  const groupLabel = useNavigationName(nameKey, group.label);
  const Icon = icon ?? Blocks;
  const containsActive = group.tabs.some((tab) => tab.id === activeTabId);
  const preferredTabId = group.storeGroupKey
    ? (lastUsedTabByGroup[group.storeGroupKey] ??
      (group.surfaceId ? lastUsedTabByGroup[`tool:${group.surfaceId}` as WorkspaceGroupKey] : null))
    : null;
  const preferredTab =
    (preferredTabId ? group.tabs.find((tab) => tab.id === preferredTabId) : null) ??
    group.tabs.find((tab) => tab.id === activeTabId) ??
    [...group.tabs].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
  const displayTab = containsActive
    ? (group.tabs.find((tab) => tab.id === activeTabId) ?? preferredTab)
    : preferredTab;
  const displayLabel = groupLabel;
  const contextLabel = group.contextLabel || group.label;
  const specificTitle = workspaceViewDisplayTitle(displayTab, group);
  const tooltipTitle =
    specificTitle !== displayLabel
      ? `${specificTitle} • ${displayLabel}${contextLabel !== group.label ? ` • ${contextLabel}` : ""}`
      : contextLabel;
  const showChevron = group.tabs.length > 1;
  const GroupIcon = getViewIcon(displayTab, Icon);
  const canCloseDisplayedTab = Boolean(
    displayTab && canClose && (!canCloseTab || canCloseTab(displayTab)),
  );
  return (
    <Renameable nameKey={nameKey} automatic={group.label}>
      <div
        draggable={false}
        data-reorder-item={group.key}
        data-reorder-preview="true"
        data-reorder-tab-id={displayTab?.id}
        data-misty-window-drag-block="true"
        className={cn(
          "group/tab flex h-7 min-w-[36px] max-w-[160px] flex-[1_1_120px] items-center",
          "rounded-md border text-xs",
          "transition-colors duration-150 select-none",
          "focus-within:ring-1 focus-within:ring-cream-muted/50",
          containsActive
            ? "border-charcoal-border/70 text-cream-bright"
            : "border-transparent text-cream-muted hover:text-cream-bright hover:text-cream",
        )}
      >
        <Pressable
          className="flex h-full min-w-0 flex-1 items-center justify-start gap-1.5 overflow-hidden pl-2 pr-1"
          data-reorder-handle="true"
          aria-description="Drag to reorder. Alt+Shift+Left or Right also moves this tab group."
          aria-pressed={containsActive}
          onClick={(event) => {
            event.stopPropagation();
            if (displayTab) onOpen(displayTab);
          }}
          title={tooltipTitle}
        >
          <GroupIcon
            aria-hidden
            size={14}
            className="size-3.5 shrink-0"
            strokeWidth={appIconStrokeWidth}
          />
          <span className="min-w-0 truncate">{displayLabel}</span>
          {showChevron ? (
            <span className="shrink-0 text-[10px] leading-none text-cream-muted tabular-nums">
              ({group.tabs.length})
            </span>
          ) : null}
        </Pressable>
        {showChevron ? (
          <DropdownMenu modal={false}>
            <MenuTrigger
              iconOnly
              size="xs"
              className="mr-1"
              label={`Show ${displayLabel} tabs`}
              icon={<ChevronDown aria-hidden size={12} className="size-3" />}
              onClick={(event) => event.stopPropagation()}
            />
            <DropdownMenuContent
              align="start"
              className="min-w-[220px]"
              onInteractOutside={(event) => {
                const target = event.target;
                if (target instanceof Element && target.closest("[data-navigation-name-editor]"))
                  event.preventDefault();
              }}
            >
              <WorkspaceViewMenuList group={group} onMoveView={onMoveTab} paneViews={paneTabs}>
                {group.tabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  const tabTitle = workspaceViewDisplayTitle(tab, group);
                  return (
                    <Renameable
                      key={tab.id}
                      nameKey={tabNameKey(tab.id)}
                      automatic={workspaceViewAutomaticTitle(tab, group)}
                    >
                      <DropdownMenuItem
                        data-reorder-item={tab.id}
                        data-reorder-handle="true"
                        aria-description="Drag to reorder. Alt+Shift+Up or Down also moves this tab."
                        onSelect={() => onOpen(tab)}
                        className={cn(
                          "flex items-center gap-2 pr-1.5",
                          isActive && "text-cream-bright",
                        )}
                      >
                        <ViewIcon tab={tab} icon={Icon} size={13} isActive={isActive} />
                        <span className="min-w-0 flex-1 truncate">{tabTitle}</span>
                        {canClose && (!canCloseTab || canCloseTab(tab)) ? (
                          <IconButton
                            size="2xs"
                            label={`Close ${tabTitle}`}
                            tooltip={false}
                            className="text-cream-muted/70"
                            data-reorder-ignore="true"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onClose(tab);
                            }}
                          >
                            <X className="size-[11px]" size={11} />
                          </IconButton>
                        ) : null}
                      </DropdownMenuItem>
                    </Renameable>
                  );
                })}
              </WorkspaceViewMenuList>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {!showChevron && canCloseDisplayedTab ? (
          <IconButton
            size="xs"
            tooltip={false}
            label={`Close ${displayTab ? workspaceViewDisplayTitle(displayTab, group) : displayLabel}`}
            className="mr-1 opacity-0 focus-visible:opacity-100 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 [@media(hover:none)]:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              if (displayTab) onClose(displayTab);
            }}
          >
            <X className="size-3" size={12} />
          </IconButton>
        ) : null}
      </div>
    </Renameable>
  );
}
function WorkspaceViewMenuList(
  props: Pick<Props, "group" | "onMoveView" | "paneViews"> & {
    children: ReactNode;
  },
) {
  const pane = () =>
    dockLeaves(useWorkspaceStore.getState().layout.root).find((leaf) =>
      leaf.views.some((tab) => tab.id === props.group.tabs[0]?.id),
    );
  const reorder = usePointerReorder({
    scope: "workspace-tabs",
    axis: "y",
    getDrag: (id) => {
      const tab = props.group.tabs.find((tab) => tab.id === id);
      return tab
        ? {
            id,
            ids: [id],
            label: workspaceViewDisplayTitle(tab, props.group),
            paneId: pane()?.id,
          }
        : null;
    },
    onDrop: (drag, target, after) => {
      const destination = pane();
      if (!destination) return;
      if (drag.paneId === destination.id)
        useWorkspaceStore.getState().reorderPaneViews(
          destination.id,
          reorderIds(
            destination.views.map((tab) => tab.id),
            [drag.id],
            target,
            after,
          ),
        );
      else
        props.onMoveView(
          drag.id,
          destination.views.findIndex((tab) => tab.id === target) + (after ? 1 : 0),
        );
    },
    onKeyboardMove: (id, direction) => {
      const destination = pane(),
        target = props.group.tabs[props.group.tabs.findIndex((tab) => tab.id === id) + direction];
      if (destination && target)
        useWorkspaceStore.getState().reorderPaneViews(
          destination.id,
          reorderIds(
            destination.views.map((tab) => tab.id),
            [id],
            target.id,
            direction === 1,
          ),
        );
    },
  });
  return <div {...reorder}>{props.children}</div>;
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
export function workspaceViewDisplayTitle(
  tab: WorkspaceView | undefined,
  group: Pick<TabGroup, "surfaceId" | "label" | "contextLabel">,
): string {
  return tab
    ? navigationName(tabNameKey(tab.id), workspaceViewAutomaticTitle(tab, group))
    : group.label;
}
export function workspaceViewAutomaticTitle(
  tab: WorkspaceView | undefined,
  group: Pick<TabGroup, "surfaceId" | "label" | "contextLabel">,
): string {
  const title = tab?.title.trim() || group.label;
  if (tab && group.surfaceId !== "space") {
    const appId = getViewAppId(tab);
    const route = new URL(tab.route, "https://misty.local");
    const view = route.searchParams.get("view") ?? "";
    const provider = route.searchParams.get("provider") ?? "";
    const generic = new Set([
      "Inbox",
      "Social",
      "Chat",
      "Browser",
      "Files",
      "Planner",
      "Journal",
      "Library",
      "Storage",
      "Agents",
    ]);
    if (!generic.has(title)) return title;
    if (route.searchParams.get("drawer") === "integrations" || view === "integrations")
      return `${group.label} integrations`;
    if (Object.prototype.hasOwnProperty.call(websiteIntegrations, provider))
      return websiteIntegrations[provider as WebsiteIntegrationId].label;
    const service = providerFromRoute(tab.route, appId === "inbox" ? "inbox" : "chat");
    if (service && ["inbox", "social", "chat"].includes(appId)) return providers[service].label;
    const sections: Record<string, Record<string, string>> = {
      planner: {
        "": "Tasks",
        tasks: "Tasks",
        agenda: "Agenda",
        roadmaps: "Roadmaps",
      },
      journal: {
        "": "Notes",
        notes: "Notes",
        drawings: "Drawings",
      },
      files: {
        "": "Explorer",
      },
      inbox: {
        "": "Misty Inbox",
        misty: "Misty Inbox",
      },
      social: {
        "": "Misty Social",
        misty: "Misty Social",
      },
      library: {
        "": "All items",
        recent: "All items",
        favorites: "Favorites",
        collections: "Collections",
        albums: "Albums",
        deleted: "Deleted",
      },
      agents: {
        "": "Conversations",
        conversations: "Conversations",
        automations: "Automations",
      },
    };
    if (appId === "browser") {
      const url = parseBrowserViewState(tab.state).url;
      try {
        return new URL(url).hostname || "New tab";
      } catch {
        return "New tab";
      }
    }
    return sections[appId]?.[view] ?? title;
  }
  if (group.surfaceId !== "space") return title;
  const contextLabel = group.contextLabel || "";
  const separatorIndex = contextLabel.lastIndexOf(" · ");
  const spaceName = separatorIndex >= 0 ? contextLabel.slice(0, separatorIndex) : "";
  const genericTitles = new Set([
    group.label,
    spaceName ? `${spaceName} ${group.label}` : "",
    spaceName ? `${spaceName} · ${group.label}` : "",
    `Space ${group.label}`,
  ]);
  return genericTitles.has(title) ? group.label : title;
}

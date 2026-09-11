import { Renameable } from "@/features/navigation-names/Renameable";
import {
  useNavigationNames,
  useNavigationName,
  navigationName,
  tabNameKey,
  groupNameKey,
} from "@/features/navigation-names/store";
import { usePointerReorder, reorderIds } from "@/shared/hooks/usePointerReorder";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import type { ReactNode } from "react";
import { BrandIcon } from "../../../../../misty-apps/apps/shared/BrandIcon";
import { brandIconAsset } from "../../../../../misty-apps/apps/shared/brandIcons";
import { DestinationIcon } from "./DownloadedAppNavigator";
import type { NavigatorAppId } from "@/features/workspace";
import { ProviderBrandIcon } from "../../../../../misty-apps/apps/shared/ProviderBrandIcon";
import {
  websiteIntegrations,
  type WebsiteIntegrationId,
} from "../../../../../misty-apps/apps/shared/websiteIntegrations";
import { WebsiteBrandIcon } from "../../../../../misty-apps/apps/shared/WebsiteBrandIcon";
import { providers, providerFromRoute } from "../../../../../misty-apps/apps/shared/providers";
import { appIconStrokeWidth } from "@/shared/ui/app-icons";
import {
  parseBrowserTabState,
  spaceWorkspaceToolFromRoute,
  type WorkspaceGroupKey,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "@/features/workspace";
import { workspaceAppIcon } from "@/features/workspace/WorkspaceAppIcon";
import { useBrowserRuntimeStore } from "@/features/browser/browserRuntime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { Blocks, ChevronDown, LoaderCircle, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

export interface TabGroup {
  instanceId?: string;
  key: string;
  surfaceId: WorkspaceSurfaceId;
  label: string;
  contextLabel?: string;
  tabs: WorkspaceTab[];
  storeGroupKey: WorkspaceGroupKey | null;
}

interface Props {
  group: TabGroup;
  icon?: LucideIcon | null;
  activeTabId: string | null;
  canClose: boolean;
  canCloseTab?: (tab: WorkspaceTab) => boolean;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  onOpen: (tab: WorkspaceTab) => void;
  onClose: (tab: WorkspaceTab) => void;
  onMoveTab: (tabId: string, dropIndex: number) => void;
  paneTabs?: WorkspaceTab[];
}

function getTabAppId(tab: WorkspaceTab | undefined): string {
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

function getTabIcon(tab: WorkspaceTab | undefined, fallback: LucideIcon): LucideIcon {
  return workspaceAppIcon(getTabAppId(tab)) ?? fallback;
}

export function TabIcon({
  tab,
  icon: DefaultIcon,
  size = 14,
  isActive = false,
}: {
  tab?: WorkspaceTab;
  icon: LucideIcon;
  size?: number;
  isActive?: boolean;
}) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const isBrowser = getTabAppId(tab) === "browser";
  const browserState = isBrowser && tab ? parseBrowserTabState(tab.state) : null;
  const isLoading = useBrowserRuntimeStore((state) =>
    tab?.id ? Boolean(state.loading[tab.id]) : false,
  );
  const faviconUrl = browserState?.faviconUrl;

  useEffect(() => setFaviconFailed(false), [faviconUrl]);

  if (isBrowser && isLoading) {
    return (
      <LoaderCircle
        className={cn("shrink-0 animate-spin", isActive ? "text-cream-bright" : "text-cream-muted")}
        size={size}
        strokeWidth={2}
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

  const appId = getTabAppId(tab);
  if (brandIconAsset(appId)) return <BrandIcon brand={appId} size={size} />;
  const provider =
    tab && (appId === "inbox" || appId === "social" || appId === "chat")
      ? providerFromRoute(tab.route, appId === "inbox" ? "inbox" : "chat")
      : null;
  if (provider)
    return (
      <span className="inline-flex shrink-0">
        <ProviderBrandIcon provider={provider} size={size} />
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
        <WebsiteBrandIcon id={website as WebsiteIntegrationId} size={size} />
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
      "transfers",
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
          item={{ id: section, label: section, route: tab.route }}
        />
      </span>
    );
  const ResolvedIcon =
    appId === "files" && tab?.route.includes("view=transfers")
      ? workspaceAppIcon("transfers")!
      : getTabIcon(tab, DefaultIcon);

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
  onMoveTab,
  paneTabs,
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
  const specificTitle = workspaceTabDisplayTitle(displayTab, group);
  const tooltipTitle =
    specificTitle !== displayLabel
      ? `${specificTitle} • ${displayLabel}${contextLabel !== group.label ? ` • ${contextLabel}` : ""}`
      : contextLabel;
  const showChevron = group.tabs.length > 1;
  const GroupIcon = getTabIcon(displayTab, Icon);
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
            ? "border-charcoal-border/70 bg-charcoal-card text-cream-bright shadow-sm"
            : "border-transparent text-cream-muted hover:bg-charcoal-card/40 hover:text-cream",
        )}
      >
        <button
          type="button"
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-2 pr-1",
            "text-left outline-none focus:outline-none focus-visible:ring-1",
            "focus-visible:ring-inset focus-visible:ring-cream-muted",
          )}
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
        </button>
        {showChevron ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "mr-1 grid size-6 shrink-0 place-items-center rounded text-cream-muted outline-none",
                  "hover:bg-charcoal-active hover:text-cream focus:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted",
                )}
                aria-label={`Show ${displayLabel} tabs`}
                onClick={(event) => event.stopPropagation()}
              >
                <ChevronDown aria-hidden size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-[220px]"
              onInteractOutside={(event) => {
                const target = event.target;
                if (target instanceof Element && target.closest("[data-navigation-name-editor]"))
                  event.preventDefault();
              }}
            >
              <WorkspaceTabMenuList group={group} onMoveTab={onMoveTab} paneTabs={paneTabs}>
                {group.tabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  const tabTitle = workspaceTabDisplayTitle(tab, group);
                  return (
                    <Renameable
                      key={tab.id}
                      nameKey={tabNameKey(tab.id)}
                      automatic={workspaceTabAutomaticTitle(tab, group)}
                    >
                      <DropdownMenuItem
                        data-reorder-item={tab.id}
                        data-reorder-handle="true"
                        aria-description="Drag to reorder. Alt+Shift+Up or Down also moves this tab."
                        onSelect={() => onOpen(tab)}
                        className={cn(
                          "flex items-center gap-2 pr-1.5",
                          isActive && "bg-charcoal-hover text-cream-bright",
                        )}
                      >
                        <TabIcon tab={tab} icon={Icon} size={13} isActive={isActive} />
                        <span className="min-w-0 flex-1 truncate">{tabTitle}</span>
                        {canClose && (!canCloseTab || canCloseTab(tab)) ? (
                          <button
                            type="button"
                            className={cn(
                              "grid size-5 shrink-0 place-items-center rounded text-cream-muted/70",
                              "hover:bg-charcoal-active hover:text-cream focus-visible:outline-none",
                              "focus-visible:ring-1 focus-visible:ring-cream-muted",
                            )}
                            data-reorder-ignore="true"
                            aria-label={`Close ${tabTitle}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onClose(tab);
                            }}
                          >
                            <X size={11} />
                          </button>
                        ) : null}
                      </DropdownMenuItem>
                    </Renameable>
                  );
                })}
              </WorkspaceTabMenuList>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {!showChevron && canCloseDisplayedTab ? (
          <button
            type="button"
            aria-label={`Close ${displayTab ? workspaceTabDisplayTitle(displayTab, group) : displayLabel}`}
            className={cn(
              "mr-1 grid size-6 shrink-0 place-items-center rounded text-cream-muted opacity-0 outline-none",
              "hover:bg-charcoal-active hover:text-cream focus:outline-none focus-visible:opacity-100",
              "focus-visible:ring-1 focus-visible:ring-cream-muted group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 [@media(hover:none)]:opacity-100",
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (displayTab) onClose(displayTab);
            }}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
    </Renameable>
  );
}

function WorkspaceTabMenuList(
  props: Pick<Props, "group" | "onMoveTab" | "paneTabs"> & { children: ReactNode },
) {
  const pane = () =>
    dockLeaves(useWorkspaceStore.getState().layout.root).find((leaf) =>
      leaf.tabs.some((tab) => tab.id === props.group.tabs[0]?.id),
    );
  const reorder = usePointerReorder({
    scope: "workspace-tabs",
    axis: "y",
    getDrag: (id) => {
      const tab = props.group.tabs.find((tab) => tab.id === id);
      return tab
        ? { id, ids: [id], label: workspaceTabDisplayTitle(tab, props.group), paneId: pane()?.id }
        : null;
    },
    onDrop: (drag, target, after) => {
      const destination = pane();
      if (!destination) return;
      if (drag.paneId === destination.id)
        useWorkspaceStore.getState().reorderPaneTabs(
          destination.id,
          reorderIds(
            destination.tabs.map((tab) => tab.id),
            [drag.id],
            target,
            after,
          ),
        );
      else
        props.onMoveTab(
          drag.id,
          destination.tabs.findIndex((tab) => tab.id === target) + (after ? 1 : 0),
        );
    },
    onKeyboardMove: (id, direction) => {
      const destination = pane(),
        target = props.group.tabs[props.group.tabs.findIndex((tab) => tab.id === id) + direction];
      if (destination && target)
        useWorkspaceStore.getState().reorderPaneTabs(
          destination.id,
          reorderIds(
            destination.tabs.map((tab) => tab.id),
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
  paneTabs: WorkspaceTab[],
  movingTabId: string,
  targetTabId: string,
): number {
  const targetIndex = paneTabs.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex < 0) return paneTabs.length;
  const sourceIndex = paneTabs.findIndex((tab) => tab.id === movingTabId);
  return sourceIndex >= 0 && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
}

export function workspaceTabDisplayTitle(
  tab: WorkspaceTab | undefined,
  group: Pick<TabGroup, "surfaceId" | "label" | "contextLabel">,
): string {
  return tab
    ? navigationName(tabNameKey(tab.id), workspaceTabAutomaticTitle(tab, group))
    : group.label;
}

export function workspaceTabAutomaticTitle(
  tab: WorkspaceTab | undefined,
  group: Pick<TabGroup, "surfaceId" | "label" | "contextLabel">,
): string {
  const title = tab?.title.trim() || group.label;
  if (tab && group.surfaceId !== "space") {
    const appId = getTabAppId(tab);
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
      planner: { "": "Tasks", tasks: "Tasks", agenda: "Agenda", roadmaps: "Roadmaps" },
      journal: { "": "Notes", notes: "Notes", drawings: "Drawings" },
      files: { "": "Explorer", transfers: "Transfers" },
      inbox: { "": "Misty Inbox", misty: "Misty Inbox" },
      social: { "": "Misty Social", misty: "Misty Social" },
      library: {
        "": "All items",
        recent: "All items",
        favorites: "Favorites",
        collections: "Collections",
        albums: "Albums",
        deleted: "Deleted",
      },
      agents: { "": "Conversations", conversations: "Conversations", automations: "Automations" },
    };
    if (appId === "browser") {
      const url = parseBrowserTabState(tab.state).url;
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

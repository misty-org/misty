import { useBrowserRuntimeStore } from "@/features/browser";
import {
  parseBrowserTabState,
  type WorkspaceGroupKey,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import {
  Blocks,
  BookOpenText,
  CheckSquare2,
  ChevronDown,
  LoaderCircle,
  MessagesSquare,
  Notebook,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

let draggingWorkspaceTabId: string | null = null;

export function currentWorkspaceTabDragId(): string | null {
  return draggingWorkspaceTabId;
}

export interface TabGroup {
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
}

function getTabIcon(tab: WorkspaceTab | undefined, fallback: LucideIcon): LucideIcon {
  if (tab?.surfaceId === "space") {
    const section = tab.route.split("/").filter(Boolean)[2];
    if (section === "notes" || section === "drawings") return Notebook;
    if (section === "planner") return CheckSquare2;
    if (section === "social" || section === "chat") return MessagesSquare;
    if (section === "library") return BookOpenText;
  }
  return fallback;
}

function TabIcon({
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
  const isBrowser = tab?.surfaceId === "browser";
  const browserState = isBrowser && tab ? parseBrowserTabState(tab.state) : null;
  const isLoading = useBrowserRuntimeStore((state) =>
    tab?.id ? Boolean(state.loading[tab.id]) : false,
  );

  const faviconUrl = browserState?.faviconUrl;

  useEffect(() => {
    setFaviconFailed(false);
  }, [faviconUrl]);

  if (isBrowser && isLoading) {
    return (
      <LoaderCircle
        size={size}
        className={cn("shrink-0 animate-spin", isActive ? "text-cream-bright" : "text-cream-muted")}
        strokeWidth={2}
      />
    );
  }

  if (isBrowser && faviconUrl && !faviconFailed) {
    return (
      <img
        key={faviconUrl}
        src={faviconUrl}
        alt=""
        decoding="async"
        draggable={false}
        className={cn(
          "shrink-0 select-none rounded-sm object-contain [image-rendering:auto]",
          size === 13 ? "size-3.5" : "size-4",
        )}
        onError={() => setFaviconFailed(true)}
      />
    );
  }

  const ResolvedIcon = getTabIcon(tab, DefaultIcon);

  return (
    <ResolvedIcon
      size={size}
      className={cn("shrink-0", isActive ? "text-cream-bright" : "text-cream-muted")}
      strokeWidth={1.7}
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
}: Props) {
  // Persisted workspace tabs can outlive the surface that originally created
  // them. Never let missing presentation metadata crash the entire workspace.
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

  const displayLabel = workspaceTabDisplayTitle(displayTab, group);
  const contextLabel = group.contextLabel || group.label;
  const tooltipTitle =
    contextLabel && contextLabel !== displayLabel
      ? `${displayLabel} • ${contextLabel}`
      : displayLabel;
  const showChevron = group.tabs.length > 1;
  const canCloseDisplayedTab = Boolean(
    displayTab && canClose && (!canCloseTab || canCloseTab(displayTab)),
  );

  return (
    <div
      draggable={displayTab !== undefined}
      className={cn(
        "group/tab flex h-7 min-w-[36px] max-w-[200px] flex-1 items-center",
        "rounded-md border text-xs",
        "transition-colors duration-150 select-none",
        containsActive
          ? "border-charcoal-border/70 bg-charcoal-card text-cream-bright shadow-sm"
          : "border-transparent text-cream-muted hover:bg-charcoal-card/40 hover:text-cream",
      )}
      onDragStart={(event) => {
        if (!displayTab) return;
        draggingWorkspaceTabId = displayTab.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-misty-workspace-tab", displayTab.id);
      }}
      onDragEnd={() => {
        draggingWorkspaceTabId = null;
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-misty-workspace-tab")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const tabId = event.dataTransfer.getData("application/x-misty-workspace-tab");
        if (tabId && displayTab) onMoveTab(tabId, group.tabs.indexOf(displayTab));
      }}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-2 pr-1 text-left outline-none focus:outline-none"
        onClick={(event) => {
          event.stopPropagation();
          if (!containsActive) {
            if (displayTab) onOpen(displayTab);
          } else if (group.tabs.length > 1) {
            const currentIndex = group.tabs.findIndex((tab) => tab.id === activeTabId);
            const nextIndex = (currentIndex + 1) % group.tabs.length;
            onOpen(group.tabs[nextIndex]);
          } else if (displayTab) {
            onOpen(displayTab);
          }
        }}
        title={tooltipTitle}
      >
        <TabIcon tab={displayTab} icon={Icon} size={14} isActive={containsActive} />
        <span
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap",
            "[mask-image:linear-gradient(to_right,black_calc(100%-12px),transparent)]",
            "[-webkit-mask-image:linear-gradient(to_right,black_calc(100%-12px),transparent)]",
          )}
        >
          {displayLabel}
        </span>
        {group.tabs.length > 1 ? (
          <span className="ml-0.5 shrink-0 rounded bg-charcoal-card px-1 text-[10px] leading-4 text-cream-muted">
            {group.tabs.length}
          </span>
        ) : null}
      </button>
      {showChevron ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "mr-0.5 grid size-5 shrink-0 place-items-center rounded text-cream-muted outline-none",
                "hover:bg-charcoal-active hover:text-cream focus:outline-none",
              )}
              aria-label={`Show ${contextLabel} tabs`}
              onClick={(event) => event.stopPropagation()}
            >
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            {group.tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const tabTitle = workspaceTabDisplayTitle(tab, group);
              return (
                <DropdownMenuItem
                  key={tab.id}
                  onSelect={() => onOpen(tab)}
                  className={cn(
                    "flex items-center gap-2 pr-1.5",
                    isActive && "bg-charcoal-hover text-cream-bright",
                  )}
                >
                  <TabIcon tab={tab} icon={Icon} size={13} isActive={isActive} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{tabTitle}</span>
                    {contextLabel !== tabTitle ? (
                      <span className="block truncate text-[10px] leading-3 text-cream-muted">
                        {contextLabel}
                      </span>
                    ) : null}
                  </span>
                  {canClose && (!canCloseTab || canCloseTab(tab)) ? (
                    <button
                      type="button"
                      className="grid size-5 shrink-0 place-items-center rounded text-cream-muted/70 hover:bg-charcoal-active hover:text-cream"
                      aria-label={`Close ${tabTitle}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onClose(tab);
                      }}
                    >
                      <X size={11} />
                    </button>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : canCloseDisplayedTab ? (
        <button
          type="button"
          aria-label={`Close ${displayTab?.title ?? group.label}`}
          className={cn(
            "mr-1 grid size-5 shrink-0 place-items-center rounded text-cream-muted opacity-0 outline-none",
            "hover:bg-charcoal-active hover:text-cream focus:outline-none group-hover/tab:opacity-100",
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
  );
}

export function workspaceTabDisplayTitle(
  tab: WorkspaceTab | undefined,
  group: Pick<TabGroup, "surfaceId" | "label" | "contextLabel">,
): string {
  const title = tab?.title.trim() || group.label;
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

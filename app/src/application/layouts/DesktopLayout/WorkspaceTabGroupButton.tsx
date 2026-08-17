import { setBrowserWebviewsSuspended } from "@/features/browser";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { ChevronDown, X, type LucideIcon } from "lucide-react";
import { useEffect } from "react";

export interface TabGroup {
  key: string;
  surfaceId: WorkspaceSurfaceId;
  label: string;
  tabs: WorkspaceTab[];
  storeGroupKey: WorkspaceGroupKey | null;
}

interface Props {
  group: TabGroup;
  icon: LucideIcon;
  activeTabId: string | null;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  onOpen: (tab: WorkspaceTab) => void;
  onClose: (tab: WorkspaceTab) => void;
  onMoveTab: (tabId: string, dropIndex: number) => void;
}

export function WorkspaceTabGroupButton({
  group,
  icon: Icon,
  activeTabId,
  lastUsedTabByGroup,
  onOpen,
  onClose,
  onMoveTab,
}: Props) {
  const popupSuspensionReason = `workspace-tab-menu:${group.key}`;
  useEffect(
    () => () => setBrowserWebviewsSuspended(false, popupSuspensionReason),
    [popupSuspensionReason],
  );

  const containsActive = group.tabs.some((tab) => tab.id === activeTabId);
  const preferredTabId = group.storeGroupKey ? lastUsedTabByGroup[group.storeGroupKey] : null;
  const preferredTab =
    (preferredTabId ? group.tabs.find((tab) => tab.id === preferredTabId) : null) ??
    group.tabs.find((tab) => tab.id === activeTabId) ??
    [...group.tabs].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
  const displayTab = containsActive
    ? (group.tabs.find((tab) => tab.id === activeTabId) ?? preferredTab)
    : preferredTab;
  const browserState =
    displayTab?.surfaceId === "browser" ? parseBrowserTabState(displayTab.state) : null;
  const displayLabel =
    group.surfaceId === "browser" && displayTab
      ? displayTab.title
      : group.surfaceId === "space" && containsActive && displayTab
        ? displayTab.title
        : group.label;
  const showChevron = group.tabs.length > 1 || group.surfaceId === "space";

  return (
    <div
      draggable={displayTab !== undefined}
      className={cn(
        "group/tab flex h-8 w-[180px] shrink-0 items-center rounded-t-md border border-b-0 text-xs",
        containsActive
          ? "border-charcoal-border bg-charcoal-bg text-cream-bright"
          : "border-transparent text-cream-muted hover:bg-charcoal-card/60 hover:text-cream",
      )}
      onDragStart={(event) => {
        if (!displayTab) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-misty-workspace-tab", displayTab.id);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-misty-workspace-tab")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const tabId = event.dataTransfer.getData("application/x-misty-workspace-tab");
        if (tabId && displayTab) onMoveTab(tabId, group.tabs.indexOf(displayTab));
      }}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden pl-2.5 pr-1 text-left"
        onClick={(event) => {
          event.stopPropagation();
          if (displayTab) onOpen(displayTab);
        }}
        title={displayTab?.title ?? group.label}
      >
        {browserState?.faviconUrl ? (
          <span className="relative grid size-4 shrink-0 place-items-center">
            <Icon size={14} className="text-cream-muted" strokeWidth={1.7} />
            <img
              src={browserState.faviconUrl}
              alt=""
              className="absolute inset-0 size-4 rounded-sm object-contain"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </span>
        ) : (
          <Icon size={14} className="shrink-0" strokeWidth={1.7} />
        )}
        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent_100%)]">
          {displayLabel}
        </span>
        {group.tabs.length > 1 ? (
          <span className="ml-1 shrink-0 rounded bg-charcoal-card px-1 text-[10px] leading-4 text-cream-muted">
            {group.tabs.length}
          </span>
        ) : null}
      </button>
      {showChevron ? (
        <DropdownMenu
          onOpenChange={(open) => setBrowserWebviewsSuspended(open, popupSuspensionReason)}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-6 place-items-center rounded text-cream-muted hover:bg-charcoal-active hover:text-cream"
              aria-label={`Show ${group.label} tabs`}
              onClick={(event) => event.stopPropagation()}
            >
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {group.tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const tabBrowserState =
                tab.surfaceId === "browser" ? parseBrowserTabState(tab.state) : null;
              return (
                <DropdownMenuItem
                  key={tab.id}
                  onSelect={() => onOpen(tab)}
                  className={cn(
                    "flex items-center gap-2 pr-1.5",
                    isActive && "bg-charcoal-hover text-cream-bright",
                  )}
                >
                  {tabBrowserState?.faviconUrl ? (
                    <img
                      src={tabBrowserState.faviconUrl}
                      alt=""
                      className="size-4 shrink-0 rounded-sm object-contain"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Icon size={13} className="shrink-0 text-cream-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  <button
                    type="button"
                    className="grid size-5 shrink-0 place-items-center rounded text-cream-muted/70 hover:bg-charcoal-active hover:text-cream"
                    aria-label={`Close ${tab.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab);
                    }}
                  >
                    <X size={11} />
                  </button>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <button
          type="button"
          aria-label={`Close ${displayTab?.title ?? group.label}`}
          className={cn(
            "mr-1 grid size-5 shrink-0 place-items-center rounded text-cream-faint opacity-0",
            "hover:bg-charcoal-active hover:text-cream group-hover/tab:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (displayTab) onClose(displayTab);
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

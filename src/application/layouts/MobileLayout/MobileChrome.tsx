import { formatActivityBadge } from "@/features/activity";
import type { MobileSurfaceChromeConfig } from "@/shared/mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { ArrowLeft, Bell, MoreHorizontal, Search } from "lucide-react";
import type { ReactNode } from "react";

export function MobileTopBar(props: {
  title: string;
  attentionCount: number;
  tabCount: number;
  onBack: () => void;
  onActivity: () => void;
  onSearch: () => void;
  onTabs: () => void;
  surfaceChrome?: MobileSurfaceChromeConfig | null;
}) {
  const detail = props.surfaceChrome?.level === "detail";
  const title = props.surfaceChrome?.title || props.title;
  const primaryAction = props.surfaceChrome?.primaryAction;
  const PrimaryActionIcon = primaryAction?.icon;
  const overflowActions = props.surfaceChrome?.overflowActions ?? [];

  return (
    <header className="flex min-h-12 items-center gap-1 border-b border-charcoal-border bg-charcoal-workspace px-1.5">
      {detail ? (
        <TopBarButton label="Go back" onClick={props.surfaceChrome?.onBack ?? props.onBack}>
          <ArrowLeft size={20} />
        </TopBarButton>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold tracking-[-0.015em] text-cream-bright">
        {title}
      </h1>
      {detail && primaryAction && PrimaryActionIcon ? (
        <TopBarButton label={primaryAction.label} onClick={primaryAction.onPress}>
          <PrimaryActionIcon size={19} />
          {primaryAction.badge ? <ActionBadge count={primaryAction.badge} /> : null}
        </TopBarButton>
      ) : (
        <TopBarButton label="Search and ask Misty" onClick={props.onSearch}>
          <Search size={19} />
        </TopBarButton>
      )}
      <TopBarButton label={`Open tabs, ${props.tabCount} open`} onClick={props.onTabs}>
        <span className="relative grid size-6 place-items-center" aria-hidden="true">
          <span className="absolute left-0.5 top-0.5 size-[18px] rounded-md border border-current opacity-50" />
          <span className="absolute bottom-0.5 right-0.5 grid size-[18px] place-items-center rounded-md border border-current bg-charcoal-workspace text-[10px] font-semibold leading-none">
            {props.tabCount > 99 ? "99" : props.tabCount}
          </span>
        </span>
      </TopBarButton>
      {detail && overflowActions.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              className="relative grid size-11 shrink-0 place-items-center rounded-lg text-cream-muted active:bg-charcoal-card active:text-cream-bright"
            >
              <MoreHorizontal size={20} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflowActions.map((action) => {
              const Icon = action.icon;
              return (
                <DropdownMenuItem
                  key={action.id}
                  disabled={action.disabled}
                  onSelect={action.onPress}
                >
                  <Icon size={17} aria-hidden="true" />
                  {action.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : !detail ? (
        <TopBarButton
          label={props.attentionCount ? `Activity, ${props.attentionCount} unread` : "Activity"}
          onClick={props.onActivity}
        >
          <Bell size={19} />
          {props.attentionCount ? <ActionBadge count={props.attentionCount} /> : null}
        </TopBarButton>
      ) : null}
    </header>
  );
}

function ActionBadge(props: { count: number }) {
  return (
    <span className="absolute right-0 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-notification-red px-1 text-[10px] font-bold text-cream-bright ring-2 ring-charcoal-workspace">
      {formatActivityBadge(props.count)}
    </span>
  );
}

function TopBarButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className="relative grid size-11 shrink-0 place-items-center rounded-lg text-cream-muted active:bg-charcoal-card active:text-cream-bright"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

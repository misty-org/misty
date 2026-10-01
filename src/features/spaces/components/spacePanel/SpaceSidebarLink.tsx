import {
  appIconStrokeWidth,
  cn,
  NavIslandItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

export function SpaceSidebarLink({
  active,
  horizontal = false,
  iconOnly = false,
  strip = false,
  badgeCount = 0,
  icon: Icon,
  label,
  to,
  onNavigate,
}: {
  active: boolean;
  horizontal?: boolean;
  iconOnly?: boolean;
  /** One equal-width icon cell of the Space sidebar's tool strip. */
  strip?: boolean;
  badgeCount?: number;
  icon: LucideIcon;
  label: string;
  to: string;
  onNavigate?: (path: string) => void;
}) {
  const link = (
    <NavIslandItem
      asChild
      active={active}
      className={cn(
        "grid h-8 min-w-0 grid-cols-[16px_minmax(0,1fr)] gap-2 px-2 text-left text-[13px] [@media(pointer:coarse)]:min-h-11",
        strip
          ? "relative h-8 w-full grid-cols-1 place-items-center gap-0 !px-0"
          : iconOnly
            ? "misty-space-rail-control relative size-10 grid-cols-1 place-items-center gap-0 p-0 [@media(pointer:coarse)]:size-11"
            : horizontal
              ? "w-auto shrink-0"
              : "w-full",
        active && "text-cream-bright",
      )}
    >
      <Link
        to={to}
        aria-label={iconOnly || strip ? label : undefined}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          if (
            !onNavigate ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          onNavigate(to);
        }}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <Icon
            className="block size-4"
            size={16}
            strokeWidth={appIconStrokeWidth}
            aria-hidden="true"
          />
        </span>
        <span className={iconOnly || strip ? "sr-only" : "flex min-w-0 items-center gap-2"}>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badgeCount > 0 ? (
            <span
              className={cn(
                "grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full",
                "bg-charcoal-active px-1 text-[10px] font-bold leading-none text-cream-bright",
              )}
              aria-label={`${badgeCount} new`}
            >
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          ) : null}
        </span>
        {(iconOnly || strip) && badgeCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-2 rounded-full bg-cream-muted"
          />
        )}
      </Link>
    </NavIslandItem>
  );
  return iconOnly || strip ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={strip ? "bottom" : "right"}>
        {label}
        {badgeCount > 0 ? ` · ${badgeCount} new` : ""}
      </TooltipContent>
    </Tooltip>
  ) : (
    link
  );
}

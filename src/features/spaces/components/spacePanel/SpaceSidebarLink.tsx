import {
  cn,
  navigationMenuLinkClass,
  navigationMenuPrimaryIconClass,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui";
import { appIconStrokeWidth } from "@/shared/ui/app-icons";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

export function SpaceSidebarLink({
  active,
  horizontal = false,
  iconOnly = false,
  badgeCount = 0,
  icon: Icon,
  label,
  to,
  onNavigate,
}: {
  active: boolean;
  horizontal?: boolean;
  iconOnly?: boolean;
  badgeCount?: number;
  icon: LucideIcon;
  label: string;
  to: string;
  onNavigate?: (path: string) => void;
}) {
  const link = (
    <Link
      className={cn(
        navigationMenuLinkClass,
        iconOnly
          ? "misty-space-rail-control relative size-10 grid-cols-1 place-items-center gap-0 p-0 [@media(pointer:coarse)]:size-11"
          : horizontal
            ? "w-auto shrink-0"
            : "w-full",
        active && "text-cream-bright",
      )}
      to={to}
      aria-label={iconOnly ? label : undefined}
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
      <span className={navigationMenuPrimaryIconClass}>
        <Icon size={18} strokeWidth={appIconStrokeWidth} aria-hidden="true" />
      </span>
      <span className={iconOnly ? "sr-only" : "flex min-w-0 items-center gap-2"}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badgeCount > 0 ? (
          <span
            className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-notification-red px-1 text-[10px] font-bold leading-none text-white"
            aria-label={`${badgeCount} new`}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        ) : null}
      </span>
      {iconOnly && badgeCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 size-2 rounded-full bg-notification-red"
        />
      )}
    </Link>
  );
  return iconOnly ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {badgeCount > 0 ? ` · ${badgeCount} new` : ""}
      </TooltipContent>
    </Tooltip>
  ) : (
    link
  );
}

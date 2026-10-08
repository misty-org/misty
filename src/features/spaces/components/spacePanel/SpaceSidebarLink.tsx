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
        // List rows read the shared sidebar metrics (App.css) so they match the Agents sidebar.
        "grid h-[var(--misty-sidebar-row-height)] min-w-0 gap-2.5 text-left",
        "grid-cols-[var(--misty-sidebar-icon-size)_minmax(0,1fr)]",
        "px-[var(--misty-sidebar-row-padding)] text-[length:var(--misty-sidebar-label-size)]",
        "[@media(pointer:coarse)]:min-h-11",
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
        <span
          className={cn(
            "grid shrink-0 place-items-center",
            iconOnly || strip ? "size-4" : "size-[var(--misty-sidebar-icon-size)]",
          )}
        >
          <Icon
            className={cn(
              "block",
              iconOnly || strip ? "size-4" : "size-[var(--misty-sidebar-icon-size)]",
            )}
            size={16}
            strokeWidth={appIconStrokeWidth}
            aria-hidden="true"
          />
        </span>
        <span className={iconOnly || strip ? "sr-only" : "flex min-w-0 items-center gap-2"}>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </span>
      </Link>
    </NavIslandItem>
  );
  return iconOnly || strip ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={strip ? "bottom" : "right"}>{label}</TooltipContent>
    </Tooltip>
  ) : (
    link
  );
}

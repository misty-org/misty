import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/ui";

export function SpaceSidebarLink({
  active,
  badgeCount = 0,
  icon: Icon,
  label,
  to,
}: {
  active: boolean;
  badgeCount?: number;
  icon: LucideIcon;
  label: string;
  to: string;
}) {
  return (
    <Link className={sidebarLinkClass(active)} to={to} aria-current={active ? "page" : undefined}>
      <span
        className={`grid size-6 shrink-0 place-items-center transition-colors ${
          active ? "text-cream" : "text-cream-muted"
        }`}
      >
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {badgeCount > 0 ? (
        <span
          className="mr-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-notification-red px-1 text-[10px] font-bold leading-none text-white"
          aria-label={`${badgeCount} new`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </Link>
  );
}

function sidebarLinkClass(isActive: boolean) {
  return cn(
    [
      "misty-marker-host relative flex h-9 min-w-0",
      "items-center gap-1.5 rounded-md text-sm no-underline outline-none",
      "focus-visible:ring-2 focus-visible:ring-charcoal-active",
    ].join(" "),
    // Selection is an edge marker, not a filled panel. Every row is a marker
    // host so hovering previews the marker; the active row grows it to full
    // height. See the marker rules in ui/styles/styles.css.
    isActive
      ? "misty-active-marker-side text-cream-bright font-medium"
      : "text-cream-muted hover:text-cream",
  );
}

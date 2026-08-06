import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/ui";

export function SpaceSidebarLink({
  active,
  icon: Icon,
  label,
  to,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  to: string;
}) {
  return (
    <Link className={sidebarLinkClass(active)} to={to} aria-current={active ? "page" : undefined}>
      <span
        className={`grid size-7 shrink-0 place-items-center transition-colors ${
          active ? "text-cream" : "text-cream-muted"
        }`}
      >
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
    </Link>
  );
}

function sidebarLinkClass(isActive: boolean) {
  return cn(
    [
      "relative flex h-9 min-w-0",
      "items-center gap-2 rounded-md px-2.5 text-sm no-underline outline-none",
      "focus-visible:ring-2 focus-visible:ring-charcoal-active",
    ].join(" "),
    // Selection is an edge marker, not a filled panel, and hovering only
    // brightens the label. See the marker rules in ui/styles/styles.css.
    isActive
      ? "misty-active-marker-side text-cream-bright font-medium"
      : "text-cream-muted hover:text-cream",
  );
}

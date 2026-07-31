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
          active ? "text-foreground" : "text-muted-foreground"
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
      "misty-hover-marker-side misty-spaces-interactive relative flex h-9 min-w-0",
      "items-center gap-2 rounded-md px-2.5 text-sm no-underline outline-none",
      "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    ].join(" "),
    isActive
      ? "misty-active-marker-side text-sidebar-accent-foreground"
      : "text-muted-foreground hover:text-foreground",
  );
}

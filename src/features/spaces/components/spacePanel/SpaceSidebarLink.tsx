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
      <span className="grid size-5 place-items-center text-muted-foreground">
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
    </Link>
  );
}

function sidebarLinkClass(isActive: boolean) {
  return cn(
    "flex h-10 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}

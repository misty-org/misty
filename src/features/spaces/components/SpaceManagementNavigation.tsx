import { SpaceMembersPopover } from "@/features/spaces/members";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@/shared/ui";
import { Settings2, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { SpaceUsagePopover } from "./SpaceUsagePopover";

export function SpaceManagementNavigation({
  space,
  section,
  placement = "header",
}: {
  space: Space | undefined;
  section: string;
  placement?: "header" | "navbar";
}) {
  const location = useLocation();
  if (!space) return null;
  const encodedSpaceId = encodeURIComponent(space.id);

  const settingsPath = `/spaces/${encodedSpaceId}/settings/general`;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1",
        placement === "header" ? "ml-auto pl-3" : "ml-0 pl-0",
      )}
    >
      <TooltipProvider delayDuration={400}>
        <nav className="flex items-center gap-1" aria-label="Space management">
          <SpaceUsagePopover space={space} />
          <SpaceMembersPopover space={space} />
          <ManagementLink
            active={section === "settings"}
            icon={Settings2}
            label="Settings"
            state={{
              spaceSettingsReturnTo: `${location.pathname}${location.search}${location.hash}`,
            }}
            to={settingsPath}
          />
        </nav>
      </TooltipProvider>
    </div>
  );
}

function ManagementLink({
  active,
  icon: Icon,
  label,
  state,
  to,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  state?: { spaceSettingsReturnTo: string };
  to: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          className={cn(
            "relative grid size-8 place-items-center rounded-md no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-charcoal-active",
            active ? "text-cream-bright" : "text-cream-muted hover:text-cream-bright",
          )}
          to={to}
          state={state}
          aria-label={label}
          aria-current={active ? "page" : undefined}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

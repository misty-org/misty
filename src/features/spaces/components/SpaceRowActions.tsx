import type { Space } from "@/api/spaces/dto/interfaces/types";
import { Button, cn } from "@/shared/ui";
import { Gauge, Settings2, UsersRound } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { SpaceMembersPopover } from "../members";
import { SpaceUsagePopover } from "./SpaceUsagePopover";

/** Direct usage, members, and settings controls for a Space. */
export function SpaceRowActions({
  space,
  onClose,
  actionClassName,
}: {
  space: Space;
  onClose?: () => void;
  actionClassName?: string;
}) {
  const location = useLocation();
  const encodedSpaceId = encodeURIComponent(space.id);
  const settingsState = {
    spaceSettingsReturnTo: `${location.pathname}${location.search}${location.hash}`,
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <SpaceUsagePopover
        space={space}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(spaceRowActionClass, actionClassName)}
            aria-label={`${space.name} usage`}
            title="Usage"
          >
            <Gauge size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        }
      />
      <SpaceMembersPopover
        space={space}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(spaceRowActionClass, actionClassName)}
            aria-label={`${space.name} members`}
            title="Members"
          >
            <UsersRound size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        }
      />
      <Button
        asChild
        variant="ghost"
        size="icon-sm"
        className={cn(spaceRowActionClass, actionClassName)}
        aria-label={`${space.name} settings`}
        title="Settings"
      >
        <Link
          to={`/spaces/${encodedSpaceId}/settings/general`}
          state={settingsState}
          onClick={onClose}
        >
          <Settings2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

const spaceRowActionClass = [
  "size-7 rounded-md p-0 text-cream-muted",
  "hover:bg-charcoal-hover hover:text-cream-bright",
  "focus-visible:ring-2 focus-visible:ring-charcoal-active",
].join(" ");

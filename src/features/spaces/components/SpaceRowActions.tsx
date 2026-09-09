import type { Space } from "@/api/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";
import { Gauge, Settings2, UsersRound } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { SpaceMembersPopover } from "../members";
import { SpaceUsagePopover } from "./SpaceUsagePopover";

/**
 * Usage, Team, and Settings for one Space, revealed on row hover.
 *
 * These used to sit behind an ellipsis menu, which cost a click and a menu
 * paint to reach three fixed destinations. The row already reveals its actions
 * on hover, so the three icons go straight there.
 */
export function SpaceRowActions({ space }: { space: Space }) {
  const location = useLocation();
  const encodedSpaceId = encodeURIComponent(space.id);
  const settingsState = {
    spaceSettingsReturnTo: `${location.pathname}${location.search}${location.hash}`,
  };

  return (
    <div className="flex items-center gap-0.5">
      <SpaceUsagePopover
        space={space}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={spaceRowActionClass}
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
            className={spaceRowActionClass}
            aria-label={`${space.name} team`}
            title="Team"
          >
            <UsersRound size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        }
      />
      <Button
        asChild
        variant="ghost"
        size="icon-sm"
        className={spaceRowActionClass}
        aria-label={`${space.name} settings`}
        title="Settings"
      >
        <Link to={`/spaces/${encodedSpaceId}/settings/general`} state={settingsState}>
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

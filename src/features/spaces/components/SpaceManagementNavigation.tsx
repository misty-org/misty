import { SpaceMembersPopover } from "@/features/spaces/members";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { IconButton } from "@/shared/ui";
import { Gauge, UsersRound } from "lucide-react";
import { SpaceUsagePopover } from "./SpaceUsagePopover";

/** Compact management actions beside the Space title. */
export function SpaceManagementNavigation({ space }: { space: Space | undefined }) {
  if (!space) return null;

  return (
    <nav className="flex shrink-0 items-center gap-1" aria-label="Space management">
      <SpaceMembersPopover
        space={space}
        side="bottom"
        trigger={
          <IconButton label="Members">
            <UsersRound aria-hidden="true" />
          </IconButton>
        }
      />
      <SpaceUsagePopover
        space={space}
        side="bottom"
        trigger={
          <IconButton label="Usage">
            <Gauge aria-hidden="true" />
          </IconButton>
        }
      />
    </nav>
  );
}

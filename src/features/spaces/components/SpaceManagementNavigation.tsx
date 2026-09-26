import { SpaceMembersPopover } from "@/features/spaces/members";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui";
import { Gauge, UsersRound } from "lucide-react";
import { SpaceUsagePopover } from "./SpaceUsagePopover";

/** Members and usage for the current Space, stacked at the foot of the Space rail. */
export function SpaceManagementNavigation({ space }: { space: Space | undefined }) {
  if (!space) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <nav className="flex shrink-0 flex-col items-center gap-1" aria-label="Space management">
        <Tooltip>
          <SpaceMembersPopover
            space={space}
            side="right"
            trigger={
              <TooltipTrigger asChild>
                <Button variant="ghost" className={railControlClass} aria-label="Members">
                  <UsersRound aria-hidden="true" />
                </Button>
              </TooltipTrigger>
            }
          />
          <TooltipContent side="right">Members</TooltipContent>
        </Tooltip>
        <Tooltip>
          <SpaceUsagePopover
            space={space}
            side="right"
            trigger={
              <TooltipTrigger asChild>
                <Button variant="ghost" className={railControlClass} aria-label="Usage">
                  <Gauge aria-hidden="true" />
                </Button>
              </TooltipTrigger>
            }
          />
          <TooltipContent side="right">Usage</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
}

const railControlClass =
  "misty-space-rail-control relative grid size-10 shrink-0 place-items-center rounded-md p-0 text-cream-muted shadow-none [@media(pointer:coarse)]:size-11";

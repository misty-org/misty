import { SpaceMembersPopover } from "@/features/spaces/members";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import { Gauge, UsersRound } from "lucide-react";
import { SpaceUsagePopover } from "./SpaceUsagePopover";

/** Members and usage for the current Space, stacked at the foot of the Space rail. */
export function SpaceManagementNavigation({
  space,
  compact = true,
}: {
  space: Space | undefined;
  compact?: boolean;
}) {
  if (!space) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <nav
        className={compact ? "flex shrink-0 flex-col items-center gap-1" : "grid gap-1"}
        aria-label="Space management"
      >
        <Tooltip>
          <SpaceMembersPopover
            space={space}
            side="right"
            trigger={
              <TooltipTrigger asChild>
                {compact ? (
                  <IconButton
                    size="lg"
                    label="Members"
                    tooltip={false}
                    className={railControlClass}
                  >
                    <UsersRound aria-hidden="true" />
                  </IconButton>
                ) : (
                  <Button variant="ghost" justify="start" className="w-full">
                    <UsersRound size={16} aria-hidden="true" />
                    Members
                  </Button>
                )}
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
                {compact ? (
                  <IconButton size="lg" label="Usage" tooltip={false} className={railControlClass}>
                    <Gauge aria-hidden="true" />
                  </IconButton>
                ) : (
                  <Button variant="ghost" justify="start" className="w-full">
                    <Gauge size={16} aria-hidden="true" />
                    Usage
                  </Button>
                )}
              </TooltipTrigger>
            }
          />
          <TooltipContent side="right">Usage</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
}

// The rail's own hover and active fill come from .misty-space-rail-control in App.css.
const railControlClass = "misty-space-rail-control relative [@media(pointer:coarse)]:size-11";

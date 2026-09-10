import type { Space } from "@/api/spaces/dto/interfaces/types";
import { cn, IconButton, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { Gauge } from "lucide-react";
import { useState, type ReactElement } from "react";
import { AccountUsagePanel } from "./AccountUsagePanel";

export function SpaceUsagePopover({
  trigger,
  side,
}: {
  space: Space;
  trigger?: ReactElement;
  side?: "bottom" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <IconButton
            label="Account usage"
            className={cn(open && "text-cream-bright")}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <Gauge size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={8}
        collisionPadding={16}
        className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-4"
      >
        <AccountUsagePanel />
      </PopoverContent>
    </Popover>
  );
}

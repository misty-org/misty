import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { Check, ChevronDown, PanelsTopLeft, Plus } from "lucide-react";
import { useState } from "react";

/**
 * A dedicated Space switcher.
 *
 * Current-Space management belongs in the primary header so this menu has one
 * predictable job: move between Spaces or create another one.
 */
export function SpaceSwitcherMenu({
  spaces,
  activeSpace,
  activeSpaceId,
  canAddSpace,
  onAddSpace,
  onSwitchSpace,
}: {
  spaces: Space[];
  activeSpace: Space | undefined;
  activeSpaceId: string;
  canAddSpace: boolean;
  onAddSpace: () => void;
  onSwitchSpace: (spaceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const title = activeSpace?.name ?? "Spaces";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          className={[
            "mb-1 h-10 w-full min-w-0 justify-start gap-2 rounded-md",
            "border-charcoal-border/55 bg-charcoal-active px-2 text-left",
            "text-cream-bright shadow-none",
            "hover:border-charcoal-border/80 hover:bg-charcoal-active",
          ].join(" ")}
          variant="outline"
          type="button"
          aria-label={activeSpace?.name ? `Space menu: ${activeSpace.name}` : "Space menu"}
          title={title}
        >
          <span className="grid size-[30px] shrink-0 place-items-center text-cream-muted">
            <PanelsTopLeft size={16} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</span>
          <ChevronDown className="shrink-0 text-cream-muted" size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[240px] min-w-[240px] bg-charcoal-card before:hidden"
        align="start"
        sideOffset={6}
      >
        <div className="misty-transient-scrollbar max-h-60 overflow-y-auto">
          {spaces.map((space) => {
            const active = space.id === activeSpaceId;
            return (
              <DropdownMenuItem
                key={space.id}
                className={`min-h-9 gap-2 ${active ? "bg-charcoal-hover text-cream" : ""}`}
                aria-current={active ? "true" : undefined}
                onSelect={() => {
                  if (!active) onSwitchSpace(space.id);
                }}
              >
                <span className="grid size-4 shrink-0 place-items-center text-cream-muted">
                  <PanelsTopLeft size={13} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
                {active ? (
                  <Check
                    className="shrink-0 text-cream"
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-9 gap-2"
          disabled={!canAddSpace}
          title={canAddSpace ? undefined : "You’ve reached your Space limit"}
          onSelect={() => onAddSpace()}
        >
          <Plus size={14} />
          Add Space
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

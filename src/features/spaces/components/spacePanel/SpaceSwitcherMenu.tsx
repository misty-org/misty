import { useState } from "react";
import { Briefcase, ChevronDown, Plus, Settings2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import type { Space } from "@/models/interfaces/features/spaces/types";

/**
 * Space title, Space management entries and the switcher, in one dropdown.
 *
 * Members and Settings live here rather than in the section navigation so the
 * navigation stays a list of daily work surfaces.
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
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // The active Space is the menu title, so it is not repeated in the list below.
  const otherSpaces = spaces.filter((space) => space.id !== activeSpaceId);
  const title = activeSpace?.name ?? "Spaces";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          className="mb-4 h-11 w-full min-w-0 justify-start gap-2.5 border-sidebar-border/60 bg-sidebar-accent/35 px-3 text-left text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent"
          variant="outline"
          type="button"
          aria-label={activeSpace?.name ? `Space menu: ${activeSpace.name}` : "Space menu"}
          title={title}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
            <Briefcase size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
          <ChevronDown className="shrink-0 text-muted-foreground" size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[240px]"
        align="start"
        sideOffset={6}
      >
        <DropdownMenuLabel className="truncate">{title}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!activeSpaceId}
          onSelect={() => navigate(`/spaces/${encodeURIComponent(activeSpaceId)}/members`)}
        >
          <Users size={14} />
          Members
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!activeSpaceId}
          onSelect={() => navigate(`/spaces/${encodeURIComponent(activeSpaceId)}/settings/general`)}
        >
          <Settings2 size={14} />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="truncate">New</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!canAddSpace}
          title={canAddSpace ? undefined : "You already own three Spaces"}
          onSelect={() => onAddSpace()}
        >
          <Plus size={14} />
          Add Space
        </DropdownMenuItem>

        {otherSpaces.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="misty-transient-scrollbar max-h-60 overflow-y-auto">
              {otherSpaces.map((space) => (
                <DropdownMenuItem
                  key={space.id}
                  className="gap-2"
                  onSelect={() => onSwitchSpace(space.id)}
                >
                  <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
                    <Briefcase size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{space.name}</span>
                </DropdownMenuItem>
              ))}
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

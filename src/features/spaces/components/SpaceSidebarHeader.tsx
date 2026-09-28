import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
} from "@/shared/ui";
import { LogOut, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { spaceNavigationName } from "../defaultSpace";
import {
  SpaceLifecycleDialog,
  spaceLifecycleAction,
  type SpaceLifecycleAction,
} from "./SpaceLifecycleDialogs";

/** The Space's name. Switching Spaces happens in the global navigator's Space stack. */
export function SpaceSidebarHeader({ space }: { space: Space }) {
  const [pending, setPending] = useState<SpaceLifecycleAction | null>(null);
  const action = spaceLifecycleAction(space);
  const name = spaceNavigationName(space);
  return (
    <header className="flex h-8 min-w-0 shrink-0 items-center gap-1 pl-2.5">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright" title={name}>
        {name}
      </h2>
      {action ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton label={`${name} options`} size="xs">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <MenuItem
              icon={action === "delete" ? <Trash2 /> : <LogOut />}
              label={action === "delete" ? "Delete Space…" : "Leave Space…"}
              destructive={action === "delete"}
              onSelect={() => setPending(action)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <SpaceLifecycleDialog space={space} action={pending} onClose={() => setPending(null)} />
    </header>
  );
}

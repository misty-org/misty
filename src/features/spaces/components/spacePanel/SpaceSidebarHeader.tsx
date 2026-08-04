import type { ReactNode } from "react";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { SpaceAvatar } from "../SpaceAvatar";
import { isMistySpace } from "../../mistySpace";

export function SpaceSidebarHeader({ space, actions }: { space: Space; actions?: ReactNode }) {
  return (
    <header className="mb-3 flex min-h-14 shrink-0 items-center gap-2 border-b border-sidebar-border/50 pb-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-2">
        <SpaceAvatar space={space} className="size-8" />
        <div className="min-w-0">
          <p className="m-0 truncate text-[13px] font-semibold text-sidebar-accent-foreground">
            {space.name}
          </p>
          <p className="mb-0 mt-0.5 text-[10px] capitalize text-muted-foreground">
            {isMistySpace(space) ? "Misty guide" : space.role}
          </p>
        </div>
      </div>
      {actions}
    </header>
  );
}

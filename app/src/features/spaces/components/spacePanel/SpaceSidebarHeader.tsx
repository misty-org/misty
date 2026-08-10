import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { ReactNode } from "react";

export function SpaceSidebarHeader({ space, actions }: { space: Space; actions?: ReactNode }) {
  return (
    <header className="-mt-3 flex min-h-14 shrink-0 -translate-y-1.5 items-center">
      <div className="flex min-w-0 flex-1 items-center px-1 py-2">
        <p className="m-0 truncate text-[13px] font-semibold text-cream-bright">{space.name}</p>
      </div>
      {actions}
    </header>
  );
}

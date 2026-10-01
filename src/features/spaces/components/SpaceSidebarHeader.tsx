import type { Space } from "@/api/spaces/dto/interfaces/types";
import { WorkspaceSidebarHeading } from "@/shared/ui";
import { SpaceManagementNavigation } from "./SpaceManagementNavigation";
import { SpaceAvatar } from "./SpaceAvatar";

/** Shared Space identity beside its title and management actions. */
export function SpaceSidebarHeader({ space }: { space: Space }) {
  return (
    <WorkspaceSidebarHeading
      title={space.name || "Space"}
      leading={<SpaceAvatar space={space} className="size-7" />}
      actions={<SpaceManagementNavigation key={space.id} space={space} />}
    />
  );
}

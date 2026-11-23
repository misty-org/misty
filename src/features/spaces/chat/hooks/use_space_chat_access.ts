import { useSpacesStore } from "../../list/use_spaces_store";
import type { Space } from "../../api/dto/entities";

export interface SpaceChatAccess {
  activeSpace: Space | undefined;
  canWriteMessages: boolean;
  isOwner: boolean;
}

export function useSpaceChatAccess(spaceId: string): SpaceChatAccess {
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  return {
    activeSpace,
    canWriteMessages: !referenceOnly,
    isOwner: activeSpace?.role === "owner",
  };
}

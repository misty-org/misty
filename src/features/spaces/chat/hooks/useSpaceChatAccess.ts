import { useSocialSpaces as useSpacesStore } from "../SocialRuntime";
import type { Space } from "@/api/spaces/dto/entities";

export interface SpaceChatAccess {
  activeSpace: Space | undefined;
  /** Every member can write; only reconnecting makes chat read-only. */
  canWriteMessages: boolean;
  isOwner: boolean;
}

/** What the current member may do in this Space's chat. */
export function useSpaceChatAccess(spaceId: string): SpaceChatAccess {
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  return {
    activeSpace,
    canWriteMessages: !referenceOnly,
    isOwner: activeSpace?.role === "owner",
  };
}

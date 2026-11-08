import type { Space } from "../../api/dto/entities";
import { useSpaceWindowStore } from "@/features/app-windows";
import { preferredDefaultSpace } from "../../routes/defaultSpace";
import { useSpacesStore } from "../../list/useSpacesStore";

/** The Space this window shows now, once the account's Spaces have loaded. */
export function useWindowSpace(): Space | undefined {
  const spaces = useSpacesStore((state) => state.spaces);
  const identity = useSpaceWindowStore((state) => state.identity);
  return identity.personal
    ? preferredDefaultSpace(spaces)
    : spaces.find((space) => space.id === identity.spaceId);
}

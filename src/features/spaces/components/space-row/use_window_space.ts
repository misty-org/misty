import type { Space } from "../../api/dto/entities";
import { useSpaceWindowStore } from "@/features/app-windows";
import { preferredDefaultSpace } from "../../routes/default_space";
import { useSpacesStore } from "../../list/use_spaces_store";

export function useWindowSpace(): Space | undefined {
  const spaces = useSpacesStore((state) => state.spaces);
  const identity = useSpaceWindowStore((state) => state.identity);
  return identity.personal
    ? preferredDefaultSpace(spaces)
    : spaces.find((space) => space.id === identity.spaceId);
}

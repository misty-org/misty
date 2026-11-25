import { spaceTone, useWindowSpace } from "@/features/spaces";
import { usePlace } from "./place_store";

export function useSidebarPlaceColor() {
  const place = usePlace();
  const space = useWindowSpace();
  return place === "spaces" && space && !space.is_default ? spaceTone(space.id) : undefined;
}

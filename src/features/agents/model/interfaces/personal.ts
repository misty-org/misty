import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
export interface GlobalSpaceLibraryHit {
  space_id: string;
  space_name: string;
  item: SpaceLibraryItem;
  deep_link: string;
}

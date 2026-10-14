import type { SpaceLibraryItem } from "./entities";

export interface GlobalSpaceLibraryHit {
  space_id: string;
  space_name: string;
  item: SpaceLibraryItem;
  deep_link: string;
}

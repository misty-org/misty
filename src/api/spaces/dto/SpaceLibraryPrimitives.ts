import type { LibraryAssetStack } from "./entities";

export type LibraryAssetStackInput = Pick<
  LibraryAssetStack,
  "kind" | "title" | "cover_item_id" | "motion_item_id" | "members"
>;

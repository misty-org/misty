import type { Space } from "../api/dto/entities";
import { preferredDefaultSpace, windowSpace } from "@/features/app-windows";

export { preferredDefaultSpace, windowSpace };

export function canManageSpaceLifecycle(
  space: Space | undefined,
  action: "rename" | "invite" | "leave" | "delete" | "transfer",
): boolean {
  if (!space) return false;
  // Owners manage the Space; everyone else may only leave it.
  if (action === "leave") return space.role !== "owner";
  if (space.is_default && (action === "delete" || action === "transfer")) return false;
  return space.role === "owner";
}

/** The name a Space goes by in menus and tabs. */
export function spaceNavigationName(space: Pick<Space, "name">): string {
  return space.name;
}

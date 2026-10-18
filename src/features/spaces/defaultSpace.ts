import type { Space } from "@/api/spaces/dto/entities";
import { spaceWindow } from "@/features/workspace/spaceWindow";

/** The account's protected default Space is the home fallback. */
export function preferredDefaultSpace(spaces: Space[]): Space | undefined {
  return (
    spaces.find((space) => space.is_default && space.role === "owner") ??
    spaces.find((space) => space.is_default) ??
    spaces[0]
  );
}

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

/**
 * The Space this window belongs to. Every window shows only its own Space; the personal
 * Space's window learns its id from the account's Spaces.
 */
export function windowSpace(spaces: Space[]): Space | undefined {
  const own = spaceWindow();
  return own.personal
    ? preferredDefaultSpace(spaces)
    : spaces.find((space) => space.id === own.spaceId);
}

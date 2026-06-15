import type { Space } from "@/api/spaces/dto/interfaces/types";

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
  if (space.is_default && (action === "delete" || action === "transfer")) return false;
  return space.permissions?.[`space.${action}`] !== false;
}

export function spaceNavigationName(space: Pick<Space, "name" | "is_default">): string {
  return space.is_default ? `${space.name} (default)` : space.name;
}

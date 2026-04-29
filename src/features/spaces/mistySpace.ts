import type { Space } from "@/services/spaces/dto/interfaces/types";

/** Misty is the home Space whenever there is no valid active selection. */
export function preferredMistySpace(spaces: Space[]): Space | undefined {
  return (
    spaces.find((space) => space.kind === "misty") ??
    spaces.find(
      (space) =>
        space.id.trim().toLocaleLowerCase() === "misty" ||
        space.name.trim().toLocaleLowerCase() === "misty",
    ) ??
    spaces[0]
  );
}

export function canManageSpaceLifecycle(
  space: Space | undefined,
  action: "rename" | "invite" | "leave" | "delete" | "transfer",
): boolean {
  if (!space) return false;
  return space.permissions?.[`space.${action}`] !== false;
}

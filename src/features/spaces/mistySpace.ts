import type { Space } from "@/models/interfaces/features/spaces/types";

export function isMistySpace(space: Space | undefined): boolean {
  return space?.kind === "misty";
}

export function canManageSpaceLifecycle(
  space: Space | undefined,
  action: "rename" | "invite" | "leave" | "delete" | "transfer",
): boolean {
  if (!space || isMistySpace(space)) return false;
  return space.permissions?.[`space.${action}`] !== false;
}

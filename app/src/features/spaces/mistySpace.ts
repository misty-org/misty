import type { Space } from "@/api/spaces/dto/interfaces/types";

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

/**
 * The canonical Misty Space is a private support inbox for regular members,
 * but operators receive the normal work-surface permissions from the server.
 * Keep that distinction permission-driven so operator tools are not hidden
 * merely because the Space has the reserved `misty` kind.
 */
export function canOpenMistySpaceSection(space: Space, section: string): boolean {
  if (space.kind !== "misty") return true;

  switch (section) {
    case "chat":
      return space.permissions?.["messages.read"] === true;
    case "planner":
      return space.permissions?.["tasks.view"] === true;
    case "library":
      return space.permissions?.["library.view"] === true;
    case "assistant":
      return space.permissions?.["agents.run"] === true;
    case "journal":
    case "notes":
    case "drawings":
    case "members":
    case "settings":
      return space.permissions?.["space.invite"] === true;
    default:
      return false;
  }
}

export function canManageSpaceLifecycle(
  space: Space | undefined,
  action: "rename" | "invite" | "leave" | "delete" | "transfer",
): boolean {
  if (!space) return false;
  return space.permissions?.[`space.${action}`] !== false;
}

import type { Space } from "../api/dto/entities";
import { canManageSpaceLifecycle } from "../routes/default_space";
import { spaceCan } from "../roles/use_space_roles";

export type SpaceSettingsPage = "overview" | "people" | "roles" | "drive";

export function spaceSettingsPages(space: Space): SpaceSettingsPage[] {
  const pages: SpaceSettingsPage[] = [];
  if (canEditSpace(space) || canDeleteSpace(space)) pages.push("overview");
  if (!space.is_default) pages.push("people");
  if (!space.is_default && spaceCan(space, "roles.manage")) pages.push("roles");
  if (canEditSpace(space)) pages.push("drive");
  return pages;
}

export function canEditSpace(space: Space): boolean {
  return spaceCan(space, "space.rename");
}

export function canDeleteSpace(space: Space): boolean {
  return space.role === "owner" && canManageSpaceLifecycle(space, "delete");
}

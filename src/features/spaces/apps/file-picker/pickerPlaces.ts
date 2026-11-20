import { folderName } from "@/features/agents";

/** A folder of a Space's drive: `path` from its root, `/` for the root itself. Files' places use it too. */
export type SpaceDrivePlace = { kind: "space-drive"; spaceId: string; path: string };

/** A Space's trash, where its drive's deleted items wait. Files shows it; the picker never opens it. */
export type SpaceDriveTrashPlace = { kind: "space-drive-trash"; spaceId: string };

/**
 * Where the file picker is looking: a folder of the Space's drive (its Files), a folder inside one
 * of the person's projects, or (adding to Media, before any folder is open) this computer as a
 * whole.
 */
export type PickerPlace =
  | SpaceDrivePlace
  | { kind: "computer" }
  | { kind: "folder"; root: string; path: string };

/** The root of a Space's drive. */
export const spaceDriveRoot = (spaceId: string): SpaceDrivePlace => ({
  kind: "space-drive",
  spaceId,
  path: "/",
});
export const COMPUTER: PickerPlace = { kind: "computer" };

export function samePlace(a: PickerPlace, b: PickerPlace): boolean {
  if (a.kind === "computer" || b.kind === "computer") return a.kind === b.kind;
  if (a.kind === "space-drive" && b.kind === "space-drive")
    return a.spaceId === b.spaceId && a.path === b.path;
  return a.kind === b.kind && a.path === b.path;
}

/** A key that names the place, for effects and resets. */
export const placeKey = (place: PickerPlace) =>
  place.kind === "folder" ? place.path : place.kind === "space-drive"
      ? `space-drive:${place.spaceId}:${place.path}`
      : place.kind;

const separatorOf = (path: string) => (path.includes("\\") && !path.includes("/") ? "\\" : "/");

/** A folder's entry by name, with the separator the folder's own path uses. */
export function childPath(folder: string, name: string): string {
  const separator = separatorOf(folder);
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}

/** The place's name, as Finder titles its window: the folder's own name, or Files for the drive's root. */
export function placeName(place: PickerPlace): string {
  if (place.kind === "space-drive")
    return place.path === "/" ? "Files" : (place.path.split("/").filter(Boolean).pop() ?? "Files");
  if (place.kind === "computer") return "This computer";
  return folderName(place.path);
}

/**
 * The folders from the project's own folder down to the place, each with its path, so the title's
 * menu can go up to any of them. Nothing above the project, which is all the picker may read.
 */
export function enclosingFolders(place: PickerPlace): Array<{ path: string; name: string }> {
  if (place.kind === "space-drive") {
    const folders = [{ path: "/", name: "Files" }];
    let path = "";
    for (const name of place.path.split("/").filter(Boolean)) {
      path = `${path}/${name}`;
      folders.push({ path, name });
    }
    return folders;
  }
  if (place.kind !== "folder") return [];
  const separator = separatorOf(place.root);
  const inside = place.path
    .slice(place.root.length)
    .split(separator)
    .filter(Boolean);
  const folders = [{ path: place.root, name: folderName(place.root) }];
  let path = place.root;
  for (const name of inside) {
    path = childPath(path, name);
    folders.push({ path, name });
  }
  return folders;
}

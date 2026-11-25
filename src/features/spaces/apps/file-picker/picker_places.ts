import { folderName } from "@/features/agents";

export type SpaceDrivePlace = { kind: "space-drive"; spaceId: string; path: string };

export type PickerPlace =
  SpaceDrivePlace | { kind: "computer" } | { kind: "folder"; root: string; path: string };

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

export const placeKey = (place: PickerPlace) =>
  place.kind === "folder"
    ? place.path
    : place.kind === "space-drive"
      ? `space-drive:${place.spaceId}:${place.path}`
      : place.kind;

const separatorOf = (path: string) => (path.includes("\\") && !path.includes("/") ? "\\" : "/");

export function childPath(folder: string, name: string): string {
  const separator = separatorOf(folder);
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}

export function placeName(place: PickerPlace): string {
  if (place.kind === "space-drive")
    return place.path === "/" ? "Files" : (place.path.split("/").filter(Boolean).pop() ?? "Files");
  if (place.kind === "computer") return "This computer";
  return folderName(place.path);
}

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
  const inside = place.path.slice(place.root.length).split(separator).filter(Boolean);
  const folders = [{ path: place.root, name: folderName(place.root) }];
  let path = place.root;
  for (const name of inside) {
    path = childPath(path, name);
    folders.push({ path, name });
  }
  return folders;
}

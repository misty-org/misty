import type { PathLineSegment } from "@misty/ui";
import type { Places } from "@/features/files";
import type { Space } from "../api/dto/entities";
import { driveParent } from "../drive";
import { spaceNavigationName } from "../routes/defaultSpace";
import type { FilesKeyCommands } from "./filesKeys";
import { foldersAbove, foldersBetween, nameOf, parentOf, type FilesPlace } from "./model";
import type { FilesBrowserState } from "./useFilesBrowser";

/** The name a sidebar list goes by, for the path when it is open. */
const listNames: Partial<Record<FilesPlace["kind"], string>> = {
  recent: "Recent",
  starred: "Starred",
  trash: "Trash",
  "agent-trash": "Agent trash",
};

/** A folder's name in the path: a drive's own name at its root, Home for the home folder. */
function folderLabel(path: string, places: Places | null): string {
  if (places?.home === path) return "Home";
  const drive = places?.drives.find((each) => each.path === path);
  if (drive) return drive.name;
  return nameOf(path) || path;
}

/** The path as the bar shows it: each folder a segment that opens it. */
export function pathSegments(
  place: FilesPlace,
  places: Places | null,
  spaces: Space[],
  go: (place: FilesPlace) => void,
): PathLineSegment[] {
  switch (place.kind) {
    case "disk": {
      // From the home folder when it is inside it, as Finder's path bar does; otherwise from the disk's top.
      const home = places?.home;
      const chain = home && (place.path === home || place.path.startsWith(`${home}/`) || place.path.startsWith(`${home}\\`))
        ? foldersBetween(home, place.path)
        : foldersAbove(place.path);
      return chain.map((path) => ({ id: path, label: folderLabel(path, places), onSelect: () => go({ kind: "disk", path }) }));
    }
    case "project":
      return foldersBetween(place.root, place.path).map((path) => ({
        id: path,
        label: nameOf(path),
        onSelect: () => go({ kind: "project", root: place.root, path }),
      }));
    case "space-drive":
    case "space-drive-trash": {
      const space = spaces.find((each) => each.id === place.spaceId);
      const name = space ? spaceNavigationName(space) : "Space";
      const root = { id: "/", label: name, onSelect: () => go({ kind: "space-drive", spaceId: place.spaceId, path: "/" }) };
      if (place.kind === "space-drive-trash") return [root, { id: "trash", label: "Trash" }];
      const parts = place.path.split("/").filter(Boolean);
      return [
        root,
        ...parts.map((part, index) => {
          const path = `/${parts.slice(0, index + 1).join("/")}`;
          return { id: path, label: part, onSelect: () => go({ kind: "space-drive", spaceId: place.spaceId, path }) };
        }),
      ];
    }
    case "tag":
      return [{ id: "tag", label: place.name }];
    default:
      return [{ id: place.kind, label: listNames[place.kind] ?? "Files" }];
  }
}

/** The folder above the open one, when there is one to go to. */
export function enclosing(place: FilesPlace): FilesPlace | undefined {
  if (place.kind === "disk") {
    const up = parentOf(place.path);
    return up === place.path ? undefined : { kind: "disk", path: up };
  }
  if (place.kind === "project")
    return place.path === place.root ? undefined : { kind: "project", root: place.root, path: parentOf(place.path) };
  if (place.kind === "space-drive")
    return place.path === "/" ? undefined : { kind: "space-drive", spaceId: place.spaceId, path: driveParent(place.path) };
  if (place.kind === "space-drive-trash") return { kind: "space-drive", spaceId: place.spaceId, path: "/" };
  return undefined;
}

/** Finder's keys, bound to what the browser does now. */
export function keyCommands(
  state: FilesBrowserState,
  order: () => { ids: string[]; perRow: number },
  focusSearch: () => void,
): FilesKeyCommands {
  const { actions, selectedItems: picked, selection, pick, granted, place, places } = state;
  const one = picked.length === 1 ? picked[0] : undefined;
  const local = picked.length > 0 && picked.every((item) => state.localPath(item));
  const renamable = one !== undefined && (state.localPath(one) !== undefined || one.source.kind === "drive");
  const up = enclosing(place);
  const trashable =
    picked.length > 0 && picked.every((item) => ["disk", "project", "drive"].includes(item.source.kind));
  const changes = !pick;
  const fixed = places.places;
  const goTo = (which: "home" | "desktop" | "documents" | "downloads" | "applications") => {
    const path = fixed?.[which];
    if (path) state.go({ kind: "disk", path }, { root: true });
  };
  return {
    order,
    selected: selection.selected,
    move: (delta, extend) => selection.move(delta, order().ids, extend),
    selectAll: () => selection.selectAll(order().ids),
    typeSelect: (text) => {
      const match = state.items.find((item) => item.name.toLocaleLowerCase().startsWith(text));
      if (match) selection.pick(match.id, order().ids);
    },
    open: () => {
      if (one) actions.open(one);
      else if (pick && picked.length) pick.onPick(picked.filter((item) => !item.folder));
    },
    up: () => up && state.go(up),
    back: state.nav.back,
    forward: state.nav.forward,
    quickLook: () => one && !one.folder && state.setQuick(one),
    info: () => state.setInfo((on) => !on),
    rename: changes && one && renamable ? () => actions.rename(one) : undefined,
    duplicate: changes && local ? () => actions.duplicate(picked) : undefined,
    copy: changes && local ? () => state.clip(picked, false) : undefined,
    cut: changes && local && granted ? () => state.clip(picked, true) : undefined,
    paste: changes && actions.canPaste ? () => void actions.paste() : undefined,
    copyPath: () => picked.length && actions.copyPath(picked),
    reveal: () => one && actions.reveal(one),
    trash: changes && trashable ? () => void actions.trash(picked) : undefined,
    deleteNow: changes && granted && local ? () => actions.deleteNow(picked) : undefined,
    newFolder: changes && actions.canCreate ? () => actions.create("folder") : undefined,
    undo: changes && granted ? () => void state.undo.undo() : undefined,
    redo: changes && granted ? () => void state.undo.redo() : undefined,
    search: focusSearch,
    toggleHidden: state.toggleHidden,
    view: (which) => state.setView(which),
    goTo: granted ? goTo : undefined,
    goToFolder: changes && granted ? () => actions.goToFolder(fixed?.home) : undefined,
    clear: () => selection.set([]),
  };
}

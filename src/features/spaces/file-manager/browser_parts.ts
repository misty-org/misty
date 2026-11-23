import { Clock, Download, FileText, HardDrive, House, Monitor, Star, Trash2 } from "lucide-react";
import type { PathLineSegment } from "@misty/ui";
import type { Places } from "@/features/files";
import type { Space } from "../api/dto/entities";
import { driveParent } from "../drive";
import { spaceNavigationName } from "../routes/default_space";
import { canCreateIn, canPasteIn } from "./file_actions";
import type { FilesView } from "./files_choices";
import type { FilesKeyCommands } from "./files_keys";
import type { SearchLocation } from "./FilesSearch";
import {
  foldersAbove,
  foldersBetween,
  localPath,
  nameOf,
  parentOf,
  type FilesPlace,
} from "./model";
import type { PaneApi } from "./pane_context";
import { sourceOf } from "./sources";
import { lowerName } from "./store/arrange";
import { usePlacesStore } from "./use_files_places";
import { stepUndo } from "./use_operations";

const listNames: Partial<Record<FilesPlace["kind"], string>> = {
  recent: "Recent",
  starred: "Starred",
  trash: "Trash",
  "agent-trash": "Agent trash",
};

function folderLabel(path: string, places: Places | null): string {
  if (path === "/") return "/";
  const drive = places?.drives.find((each) => each.path === path);
  if (drive) return drive.name;
  return nameOf(path) || path;
}

export function pathSegments(
  place: FilesPlace,
  places: Places | null,
  spaces: Space[],
  go: (place: FilesPlace) => void,
): PathLineSegment[] {
  switch (place.kind) {
    case "disk": {
      return foldersAbove(place.path).map((path) => ({
        id: path,
        label: folderLabel(path, places),
        onSelect: () => go({ kind: "disk", path }),
      }));
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
      const root = {
        id: "/",
        label: name,
        onSelect: () => go({ kind: "space-drive", spaceId: place.spaceId, path: "/" }),
      };
      if (place.kind === "space-drive-trash") return [root, { id: "trash", label: "Trash" }];
      const parts = place.path.split("/").filter(Boolean);
      return [
        root,
        ...parts.map((part, index) => {
          const path = `/${parts.slice(0, index + 1).join("/")}`;
          return {
            id: path,
            label: part,
            onSelect: () => go({ kind: "space-drive", spaceId: place.spaceId, path }),
          };
        }),
      ];
    }
    case "tag":
      return [{ id: "tag", label: place.name }];
    default:
      return [{ id: place.kind, label: listNames[place.kind] ?? "Files" }];
  }
}

export function typedPath(place: FilesPlace): string {
  return place.kind === "disk" || place.kind === "project" ? place.path : "";
}

export function searchLocations(
  places: Places | null,
  spaces: Space[],
  granted: boolean,
): SearchLocation[] {
  const list: SearchLocation[] = [];
  if (granted && places) {
    const fixed: [string | undefined, string, SearchLocation["icon"]][] = [
      [places.home, "Home", House],
      [places.desktop, "Desktop", Monitor],
      [places.documents, "Documents", FileText],
      [places.downloads, "Downloads", Download],
    ];
    for (const [path, label, icon] of fixed)
      if (path) list.push({ id: path, label, detail: path, icon, place: { kind: "disk", path } });
    for (const drive of places.drives)
      list.push({
        id: drive.path,
        label: drive.name,
        detail: drive.path,
        icon: HardDrive,
        place: { kind: "disk", path: drive.path },
      });
    list.push(
      {
        id: "recent",
        label: "Recent",
        detail: "Files you opened",
        icon: Clock,
        place: { kind: "recent" },
      },
      {
        id: "starred",
        label: "Starred",
        detail: "Starred items",
        icon: Star,
        place: { kind: "starred" },
      },
      {
        id: "trash",
        label: "Trash",
        detail: "Moved to the Trash",
        icon: Trash2,
        place: { kind: "trash" },
      },
    );
  }
  for (const space of spaces)
    list.push({
      id: `space:${space.id}`,
      label: spaceNavigationName(space),
      detail: "Space",
      icon: HardDrive,
      place: { kind: "space-drive", spaceId: space.id, path: "/" },
    });
  return list;
}

export function enclosing(place: FilesPlace): FilesPlace | undefined {
  if (place.kind === "disk") {
    const up = parentOf(place.path);
    return up === place.path ? undefined : { kind: "disk", path: up };
  }
  if (place.kind === "project")
    return place.path === place.root
      ? undefined
      : { kind: "project", root: place.root, path: parentOf(place.path) };
  if (place.kind === "space-drive")
    return place.path === "/"
      ? undefined
      : { kind: "space-drive", spaceId: place.spaceId, path: driveParent(place.path) };
  if (place.kind === "space-drive-trash")
    return { kind: "space-drive", spaceId: place.spaceId, path: "/" };
  return undefined;
}

export interface KeyExtras {
  setInfo(next: (on: boolean) => boolean): void;
  setView(view: FilesView): void;
  toggleHidden(): void;
  focusSearch(): void;
}

export function keyCommands(pane: PaneApi, extras: KeyExtras): FilesKeyCommands {
  const { actions, pick, granted, store } = pane;
  const state = store.getState();
  const shown = pane.shown.current;
  const picked = [...state.selected].flatMap((id) => shown.get(id) ?? []);
  const order = () => {
    const reported = pane.order.current;
    return reported.ids.length === shown.size ? reported : { ids: [...shown.keys()], perRow: 1 };
  };
  const one = picked.length === 1 ? picked[0] : undefined;
  const local = picked.length > 0 && picked.every((item) => localPath(item));
  const renamable = one !== undefined && sourceOf(one).canRename;
  const up = enclosing(state.place);
  const trashable = picked.length > 0 && picked.every((item) => sourceOf(item).canTrash);
  const changes = !pick;
  const fixed = usePlacesStore.getState().places;
  const goTo = (which: "home" | "desktop" | "documents" | "downloads" | "applications") => {
    const path = fixed?.[which];
    if (path) state.go({ kind: "disk", path }, { root: true });
  };
  return {
    order,
    selected: [...state.selected],
    move: (delta, extend) => state.move(delta, order().ids, extend),
    selectAll: () => state.selectAll(order().ids),
    typeSelect: (text) => {
      const match = order().ids.find((id) => {
        const item = shown.get(id);
        return item !== undefined && lowerName(item).startsWith(text);
      });
      if (match) state.pick(match, order().ids);
    },
    open: () => {
      if (one) actions.open(one);
      else if (pick && picked.length) pick.onPick(picked.filter((item) => !item.folder));
    },
    up: () => up && state.go(up),
    back: state.back,
    forward: state.forward,
    quickLook: () => one && !one.folder && state.setQuick(one),
    info: () => extras.setInfo((on) => !on),
    rename: changes && one && renamable ? () => actions.rename(one) : undefined,
    duplicate: changes && local ? () => actions.duplicate(picked) : undefined,
    copy: changes && local ? () => actions.clip(picked, false) : undefined,
    cut: changes && local && granted ? () => actions.clip(picked, true) : undefined,
    paste: changes && canPasteIn(state.place, granted) ? () => void actions.paste() : undefined,
    copyPath: () => picked.length && actions.copyPath(picked),
    reveal: () => one && actions.reveal(one),
    trash: changes && trashable ? () => void actions.trash(picked) : undefined,
    deleteNow: changes && granted && local ? () => actions.deleteNow(picked) : undefined,
    newFolder:
      changes && canCreateIn(state.place, granted) ? () => actions.create("folder") : undefined,
    undo: changes && granted ? () => void stepUndo("undo") : undefined,
    redo: changes && granted ? () => void stepUndo("redo") : undefined,
    search: extras.focusSearch,
    toggleHidden: extras.toggleHidden,
    view: (which) => extras.setView(which),
    goTo: granted ? goTo : undefined,
    goToFolder: changes && granted ? state.editPath : undefined,
    clear: () => state.select([]),
  };
}

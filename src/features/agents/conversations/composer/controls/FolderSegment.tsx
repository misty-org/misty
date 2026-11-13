import { Folder, FolderPlus } from "lucide-react";
import { useEffect } from "react";
import {
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  notify,
  type PathLineSegment,
} from "@/shared/ui";
import { folderName, folderOf, useSpaceFolders } from "../../../engines/enginesApi";

/**
 * The folder an engine's turn runs in for a Space (the key from `folderSpaceKey`): the one picked
 * among the Space's linked folders on this computer, else the first. The composer's branch and
 * `@` files follow the same folder.
 */
export function useEngineFolder(space: string, enabled: boolean): string {
  const folder = useSpaceFolders((state) => folderOf(state, space));
  useEffect(() => {
    if (enabled)
      void useSpaceFolders
        .getState()
        .load(space)
        .catch(() => undefined);
  }, [enabled, space]);
  return enabled ? folder : "";
}

/**
 * The folder part of the composer's path line for an agent on an outside engine: the Space's
 * linked folder its turns run in, the others to pick from, and a way to link one.
 */
export function useEngineFolderSegment(space: string, folder: string): PathLineSegment {
  const folders = useSpaceFolders((state) => state.folders[space]);
  const names = useSpaceFolders((state) => state.prefs[space]?.names);
  const archived = useSpaceFolders((state) => state.prefs[space]?.archived);
  const nameOf = (path: string) => names?.[path] || folderName(path);
  const active = (folders ?? []).filter((path) => !archived?.includes(path));
  const link = () =>
    void useSpaceFolders
      .getState()
      .link(space)
      .catch(() =>
        notify({
          message: "That folder couldn't be linked. Try another one.",
          tone: "error",
          id: "composer-folder",
        }),
      );
  return {
    id: "folder",
    icon: Folder,
    label: folder ? nameOf(folder) : "No folder",
    menu: (
      <>
        {active.length ? (
          <>
            <MenuLabel>Folder</MenuLabel>
            <MenuRadioGroup
              value={folder}
              onValueChange={(path) => useSpaceFolders.getState().choose(space, path)}
            >
              {active.map((path) => (
                <MenuRadioItem key={path} value={path} label={nameOf(path)} />
              ))}
            </MenuRadioGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon={FolderPlus} label="Link a folder" onSelect={link} />
      </>
    ),
  };
}

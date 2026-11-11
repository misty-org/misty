import { Check, FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  ErrorNotification,
  MenuItem,
  MenuTrigger,
  Skeleton,
} from "@/shared/ui";
import { currentSpaceKey, folderName, folderOf, useSpaceFolders } from "../engines/enginesApi";
import { errorText } from "./projectApi";

/** One empty list, so a store selector for a Space with no folders yet returns the same value each render. */
const noFolders: string[] = [];

/** The Space's linked folders, and which one the panels and engines work in. */
export function useProjectFolder(): { space: string; folder: string; loaded: boolean } {
  const space = currentSpaceKey();
  const folder = useSpaceFolders((state) => folderOf(state, space));
  const loaded = useSpaceFolders((state) => state.folders[space] !== undefined);
  useEffect(() => {
    void useSpaceFolders
      .getState()
      .load(space)
      .catch(() => undefined);
  }, [space]);
  return { space, folder, loaded };
}

/**
 * The folder the panel shows, as a menu: the Space's linked folders with a checkmark on the one
 * in use, a way to link another through the system's folder picker, and a way to unlink this one.
 */
export function FolderPicker() {
  const { space, folder, loaded } = useProjectFolder();
  const linked = useSpaceFolders((state) => state.folders[space] ?? noFolders);
  const [error, setError] = useState("");
  const link = () =>
    void useSpaceFolders
      .getState()
      .link(space)
      .catch((reason) => setError(errorText(reason)));
  if (!loaded) return <Skeleton className="h-6 w-36" />;
  if (!folder)
    return (
      <>
        <Button type="button" variant="outline" size="sm" onClick={link}>
          <FolderPlus size={15} />
          Link a folder
        </Button>
        <ErrorNotification message={error} onDismiss={() => setError("")} />
      </>
    );
  return (
    <>
      <DropdownMenu>
        <MenuTrigger
          label="Project folder"
          value={<span className="truncate">{folderName(folder)}</span>}
          variant="ghost"
          title={folder}
          className="min-w-0"
        />
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-16px)]">
          {linked.map((path) => (
            <MenuItem
              key={path}
              icon={path === folder ? <Check className="size-4" /> : <span className="size-4" />}
              label={folderName(path)}
              onSelect={() => useSpaceFolders.getState().choose(space, path)}
            />
          ))}
          <DropdownMenuSeparator />
          <MenuItem
            icon={<FolderPlus className="size-4" />}
            label="Link a folder"
            onSelect={link}
          />
          <MenuItem
            icon={<X className="size-4" />}
            label={`Unlink ${folderName(folder)}`}
            onSelect={() =>
              void useSpaceFolders
                .getState()
                .unlink(space, folder)
                .catch((reason) => setError(errorText(reason)))
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </>
  );
}

import { useEffect } from "react";
import { folderOf, useSpaceFolders } from "../../../engines/enginesApi";

/**
 * The folder an engine's turn runs in for a Space (the key from `folderSpaceKey`): the one picked
 * among the Space's linked folders on this computer, else the first. The composer's `@` files
 * follow the same folder.
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

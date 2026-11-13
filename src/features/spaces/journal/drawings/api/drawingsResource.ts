import { useSpaceResource } from "../../../api/spaceResource";
import type { SpaceDrawing } from "../drawingTypes";
import { drawingsApi } from "./api";

/** Where a Space's drawings live, the key every screen that lists them shares. */
export const spaceDrawingsPath = (spaceId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/drawings`;

type ListDrawings = (spaceId: string) => Promise<{ drawings: SpaceDrawing[] }>;

/**
 * A Space's drawings, the one copy the Journal, the home page and the overview read: the last
 * list paints at once on a revisit or relaunch and a fresh one follows. `spaceId` empty holds off.
 */
export function useSpaceDrawingList(spaceId: string, list: ListDrawings = drawingsApi.list) {
  return useSpaceResource<SpaceDrawing[]>(spaceId ? spaceDrawingsPath(spaceId) : null, () =>
    list(spaceId).then((result) => result.drawings),
  );
}

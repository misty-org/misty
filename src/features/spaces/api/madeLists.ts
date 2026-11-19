import { decksApi, type SpaceDeck } from "../slides/api";
import { workbooksApi, type SpaceWorkbook } from "../data/api";
import { useSpaceResource } from "./spaceResource";

const listPath = (spaceId: string, part: "decks" | "workbooks") =>
  `/spaces/${encodeURIComponent(spaceId)}/${part}`;

/**
 * A Space's decks, the one copy the home, the overview and the Slides page read: the last list
 * paints at once on a revisit or relaunch and a fresh one follows. `spaceId` empty holds off.
 */
export function useSpaceDeckList(spaceId: string) {
  return useSpaceResource<SpaceDeck[]>(spaceId ? listPath(spaceId, "decks") : null, () =>
    decksApi.list(spaceId).then((result) => result.decks),
  );
}

/** A Space's workbooks, shared the same way as its decks. */
export function useSpaceWorkbookList(spaceId: string) {
  return useSpaceResource<SpaceWorkbook[]>(spaceId ? listPath(spaceId, "workbooks") : null, () =>
    workbooksApi.list(spaceId).then((result) => result.workbooks),
  );
}

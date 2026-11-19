import { useCallback, useEffect } from "react";
import { useSpaceResource } from "../../api/spaceResource";
import { decksApi, spaceDecksPath, type SpaceDeck } from "../api";
import { notifyDeckListChanged, subscribeToDeckListChanges } from "../deckEvents";
import { closeDeckCollaborationSession } from "../session";

const noDecks: SpaceDeck[] = [];

/**
 * A Space's decks, shared by every screen that lists them: the last list paints at once and a
 * fresh one follows. `loading` is true only on a first load with nothing saved.
 */
export function useSpaceDecks(spaceId: string) {
  const resource = useSpaceResource<SpaceDeck[]>(spaceId ? spaceDecksPath(spaceId) : null, () =>
    decksApi.list(spaceId).then((result) => result.decks),
  );
  const decks = resource.data ?? noDecks;
  const { set: setDecks, reload: reloadList } = resource;
  const reload = useCallback(async () => (await reloadList()) ?? [], [reloadList]);

  useEffect(() => subscribeToDeckListChanges(spaceId, () => void reload()), [reload, spaceId]);

  const rename = useCallback(
    async (deckId: string, title: string) => {
      const deck = await decksApi.rename(spaceId, deckId, title);
      setDecks((current = []) => current.map((item) => (item.id === deckId ? deck : item)));
      notifyDeckListChanged(spaceId);
      return deck;
    },
    [setDecks, spaceId],
  );

  const remove = useCallback(
    async (deckId: string) => {
      await decksApi.remove(spaceId, deckId);
      setDecks((current = []) => current.filter((item) => item.id !== deckId));
      notifyDeckListChanged(spaceId);
      closeDeckCollaborationSession(spaceId, deckId);
    },
    [setDecks, spaceId],
  );

  return {
    decks,
    loading: resource.loading,
    error:
      resource.error && !resource.data
        ? resource.error instanceof Error
          ? resource.error.message
          : "Could not load slides."
        : null,
    reload,
    rename,
    remove,
  };
}

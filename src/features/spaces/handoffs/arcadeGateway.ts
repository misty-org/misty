import { spacesApi } from "../api/api";
import { notesApi } from "../journal/notes/api/api";

/** A Library file is a game when it is a single HTML page its agent tagged as one. */
const isGame = (item: { display_name: string; tags: string[] }) =>
  /\.html?$/i.test(item.display_name) && item.tags.some((tag) => tag.toLowerCase() === "game");

/**
 * What the studio needs from a Space: the games its agents made for the arcade cabinet, and the
 * counts its unlocks are earned by.
 */
export const arcadeGateway = {
  /** The Space's games, newest first. */
  async spaceGames(spaceId: string): Promise<{ id: string; name: string; addedAt: string }[]> {
    const { items } = await spacesApi.libraryItems(spaceId, {
      limit: 200,
      sort: "recently-added",
      direction: "desc",
    });
    return items.filter(isGame).map((item) => ({
      id: item.id,
      name: item.display_name.replace(/\.html?$/i, ""),
      addedAt: item.added_at,
    }));
  },
  /** One game's page, to play in a sandboxed frame. */
  async gameHtml(spaceId: string, itemId: string): Promise<string> {
    return (await spacesApi.libraryContent(spaceId, itemId)).text();
  },
  /** How many notes the Space has, for its milestones. */
  async noteCount(spaceId: string): Promise<number> {
    return (await notesApi.list(spaceId)).notes.length;
  },
};

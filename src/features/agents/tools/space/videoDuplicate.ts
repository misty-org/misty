import {
  copyVideoProject,
  VIDEO_PROJECT_EXTENSION,
  VIDEO_PROJECT_MIME,
  type VideoProjectDocument,
} from "@/features/files";
import { spacesGateway, type LiveLibraryVideo } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler } from "../host";
import { refuse } from "./api";
import { text } from "./args";
import { routedTool } from "./routing";

/**
 * An agent copying a video project in the Space's Media into a new project of its own, to make
 * variants ("ten versions, a different hook each") and edit each one apart. The copy points at
 * the same Media items, so nothing but the project is copied.
 */

const UNAVAILABLE = "Video projects can't be reached here: the Space's server can't be reached.";

export const videoDuplicateTool: LocalToolHandler = routedTool("change", async (request, space) => {
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  const itemId = text(request.input, "item_id", { max: 200 }).trim();
  if (!itemId) throw refuse("item_id is required");
  const asked = text(request.input, "name", { max: 200 }).trim();
  let video: LiveLibraryVideo;
  try {
    video = await gateway.openLibraryVideo(space.id, itemId);
  } catch (error) {
    if (error instanceof Error && error.message === "This Media item isn't a video project.")
      throw refuse(error.message);
    throw refuse(UNAVAILABLE, "unavailable");
  }
  let document: VideoProjectDocument;
  const original = video.name;
  try {
    document = await video.read();
  } catch (error) {
    throw refuse(error instanceof Error ? error.message : "The video project can't be read.");
  } finally {
    video.close();
  }
  const name = (asked || `${original} copy`).replace(/\.mistyvideo$/i, "");
  const copy = copyVideoProject(document, name);
  const blob = new Blob([JSON.stringify(copy)], { type: VIDEO_PROJECT_MIME });
  const filename = `${name}${VIDEO_PROJECT_EXTENSION}`;
  let result: Awaited<ReturnType<typeof gateway.uploadLibraryBlob>>;
  try {
    result = await gateway.uploadLibraryBlob(space.id, blob, filename, "library");
  } catch (error) {
    throw refuse(
      error instanceof Error ? error.message : "The copy could not be added to Media.",
      "unavailable",
    );
  }
  if (!result.item) throw refuse("The copy could not be added to Media.", "unavailable");
  return { item_id: result.item.id, name };
});

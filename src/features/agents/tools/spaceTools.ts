import type { LocalToolHandler } from "./host";
import { drawingTools } from "./space/drawings";
import { deckTools } from "./space/decks";
import { workbookTools } from "./space/workbooks";
import { fileTools } from "./space/files";
import { imageTools } from "./space/images";
import { itemTools } from "./space/items";
import { spaceAdminTools } from "./space/manage";
import { memberTools } from "./space/members";
import { messageTools } from "./space/messages";
import { noteTools } from "./space/notes";
import { searchTools } from "./space/search";
import { threadTools } from "./space/threads";
import { videoTools } from "./space/videos";
import { mediaTools } from "./space/media";
import { videoAnalysisTool } from "./space/videoAnalysis";
import { videoDuplicateTool } from "./space/videoDuplicate";

/**
 * An agent's Space tools, run on this computer through the person's own signed-in session
 * The server checks them like any request of theirs.
 */
export const spaceTools: Record<string, LocalToolHandler> = {
  ...noteTools,
  ...drawingTools,
  ...deckTools,
  ...workbookTools,
  ...imageTools,
  ...fileTools,
  ...messageTools,
  ...threadTools,
  ...itemTools,
  ...spaceAdminTools,
  ...memberTools,
  ...searchTools,
  ...videoTools,
  ...mediaTools,
  "video.analysis": videoAnalysisTool,
  "video.duplicate": videoDuplicateTool,
};

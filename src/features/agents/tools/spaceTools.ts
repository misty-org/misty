import type { LocalToolHandler } from "./host";
import { fileTools } from "./space/files";
import { itemTools } from "./space/items";
import { spaceAdminTools } from "./space/manage";
import { memberTools } from "./space/members";
import { messageTools } from "./space/messages";
import { searchTools } from "./space/search";
import { threadTools } from "./space/threads";
import { mediaTools } from "./space/media";

/**
 * An agent's Space tools, run on this computer through the person's own signed-in session
 * The server checks them like any request of theirs.
 */
export const spaceTools: Record<string, LocalToolHandler> = {
  ...fileTools,
  ...messageTools,
  ...threadTools,
  ...itemTools,
  ...spaceAdminTools,
  ...memberTools,
  ...searchTools,
  ...mediaTools,
};

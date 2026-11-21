import { useLocation } from "react-router-dom";
import { useWorkspaceViewTitle, type WorkspaceView } from "@/features/app-windows";
import { DmView } from "./DmView";
import { FriendsPage } from "./FriendsPage";

/** The DM a route opens, from `/dms/<id>`. */
function routeDmId(pathname: string): string | undefined {
  const match = /^\/dms\/([^/?#]+)/.exec(pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1];
  }
}

/** The Friends page, named in its tab. */
function FriendsView({ tab }: { tab: WorkspaceView }) {
  useWorkspaceViewTitle(tab.id, "Friends");
  return <FriendsPage />;
}

/**
 * The account's own pages in a tab, from the tab's route: `/friends` is the Friends page and
 * `/dms/<id>` a DM, which names its tab after its people.
 */
export function DirectSurface({ tab }: { tab: WorkspaceView }) {
  const location = useLocation();
  const dmId = routeDmId(location.pathname);
  if (dmId) return <DmView key={dmId} tab={tab} dmId={dmId} />;
  return <FriendsView tab={tab} />;
}

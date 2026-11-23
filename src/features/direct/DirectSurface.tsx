import { useLocation } from "react-router-dom";
import { useWorkspaceViewTitle, type WorkspaceView } from "@/features/app-windows";
import { DmView } from "./DmView";
import { FriendsPage } from "./FriendsPage";

function routeDmId(pathname: string): string | undefined {
  const match = /^\/dms\/([^/?#]+)/.exec(pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1];
  }
}

function FriendsView({ tab }: { tab: WorkspaceView }) {
  useWorkspaceViewTitle(tab.id, "Friends");
  return <FriendsPage />;
}

export function DirectSurface({ tab }: { tab: WorkspaceView }) {
  const location = useLocation();
  const dmId = routeDmId(location.pathname);
  if (dmId) return <DmView key={dmId} tab={tab} dmId={dmId} />;
  return <FriendsView tab={tab} />;
}

import { attachFileToChat } from "@/features/agents";
import { webTabIdOfRoute, webTabRoutePrefix, webTabRouteFor, WebTabPage } from "@/features/browser";
import type { WorkspaceView } from "@/features/app-windows";
import { useSpacesStore, useWindowSpace } from "@/features/spaces";
import { requestOpenRoute } from "@/shared/lib/open_route";
import { QuietPane } from "@misty/ui";
import { agentChatRoute, openWorkspaceRouteIn } from "./space_navigation";
import { webTabTranslator } from "./WebTabTranslator";

async function addToChat(file: File) {
  const { agentId, conversationId } = await attachFileToChat(file);
  if (agentId) requestOpenRoute(agentChatRoute(agentId, conversationId));
}

export function WebTabSurface({ tab }: { tab: WorkspaceView }) {
  const space = useWindowSpace();
  const spaces = useSpacesStore((state) => state.spaces);
  const tabId = webTabIdOfRoute(tab.route);
  if (!tabId) return <QuietPane className="h-full" />;
  return (
    <WebTabPage
      key={tabId}
      tabId={tabId}
      viewId={tab.id}
      spaceId={space?.id ?? ""}
      spaceName={(id) => spaces.find((item) => item.id === id)?.name ?? "Space"}
      onShowFiles={(spaceId) => requestOpenRoute(`/spaces/${encodeURIComponent(spaceId)}/files`)}
      onSwitchTab={(id) => requestOpenRoute(`${webTabRoutePrefix}${id}`)}
      onOpenBeside={(url) => openWorkspaceRouteIn(webTabRouteFor(url), "right", () => undefined)}
      translator={webTabTranslator}
      onAddToChat={addToChat}
    />
  );
}

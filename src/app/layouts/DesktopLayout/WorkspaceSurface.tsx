import { SpaceWorkspaceSurface } from "@/features/spaces";
import { AgentsPage } from "@/features/agents";
import { DirectSurface } from "@/features/direct";
import {
  WorkspaceViewRouteScope,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { QuietPane } from "@misty/ui";
import { WebTabSurface } from "./WebTabSurface";

export function WorkspaceSurface({ tab }: { tab: WorkspaceView }) {
  if (tab.placeholder) return <EmptyWorkspacePane />;
  return (
    <RenderErrorBoundary key={`${tab.id}:${tab.surfaceId}`} scope="tab">
      <div
        className="contents"
        onInputCapture={() => useWorkspaceStore.getState().commitPlaceholder(tab.id)}
        onClickCapture={() => useWorkspaceStore.getState().commitPlaceholder(tab.id)}
      >
        <WorkspaceViewRouteScope tab={tab}>
          {tab.surfaceId === "space" ? (
            <SpaceWorkspaceSurface tab={tab} />
          ) : tab.surfaceId === "agents" ? (
            <AgentsPage />
          ) : tab.surfaceId === "direct" ? (
            <DirectSurface tab={tab} />
          ) : tab.surfaceId === "browser" ? (
            <WebTabSurface tab={tab} />
          ) : (
            <EmptyWorkspacePane />
          )}
        </WorkspaceViewRouteScope>
      </div>
    </RenderErrorBoundary>
  );
}

export function EmptyWorkspacePane() {
  return <QuietPane className="h-full" />;
}

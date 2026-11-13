import { SpaceWorkspaceSurface } from "@/features/spaces";
import { AgentsPage } from "@/features/agents";
import {
  WorkspaceViewRouteScope,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { QuietPane } from "@/shared/ui";

export function WorkspaceSurface({ tab }: { tab: WorkspaceView }) {
  // A new tab or split waits idle until something is opened in it. It sits outside the wrapper
  // below, so a click in the empty pane doesn't turn it into a page.
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
          ) : (
            // A view this build has no page for. Saved ones are dropped as a window loads.
            <EmptyWorkspacePane />
          )}
        </WorkspaceViewRouteScope>
      </div>
    </RenderErrorBoundary>
  );
}

/** An empty pane: the same view as the startup splash, Misty flying behind a line. */
export function EmptyWorkspacePane() {
  return <QuietPane className="h-full" />;
}

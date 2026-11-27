import { lazy, Suspense } from "react";
import {
  WorkspaceViewRouteScope,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/app-windows";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { QuietPane } from "@misty/ui";

const SpaceWorkspaceSurface = lazy(() =>
  import("@/features/spaces/overview/SpaceWorkspaceSurface").then((module) => ({
    default: module.SpaceWorkspaceSurface,
  })),
);
const AgentsPage = lazy(() => import("@/features/agents/page/AgentsPage"));
const DirectSurface = lazy(() =>
  import("@/features/direct/DirectSurface").then((module) => ({ default: module.DirectSurface })),
);
const WebTabSurface = lazy(() =>
  import("./WebTabSurface").then((module) => ({ default: module.WebTabSurface })),
);

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
          <Suspense fallback={null}>
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
          </Suspense>
        </WorkspaceViewRouteScope>
      </div>
    </RenderErrorBoundary>
  );
}

export function EmptyWorkspacePane() {
  return <QuietPane className="h-full" />;
}

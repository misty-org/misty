import { SpaceWorkspaceSurface } from "@/features/spaces/SpaceWorkspaceSurface";
import { BrowserWorkspace } from "@/features/browser/workspace";
import { AgentsPage } from "@/features/agents";
import {
  WorkspaceViewRouteScope,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { migrateRetiredWorkspaceView } from "@/features/workspace/workspaceMigrations";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { FlyingMisty } from "@/shared/ui";

export function WorkspaceSurface({ tab }: { tab: WorkspaceView }) {
  const current = migrateRetiredWorkspaceView(tab);
  return (
    <RenderErrorBoundary key={`${current.id}:${current.surfaceId}`} scope="tab">
      <div
        className="contents"
        onInputCapture={() => useWorkspaceStore.getState().commitPlaceholder(current.id)}
        onClickCapture={() => useWorkspaceStore.getState().commitPlaceholder(current.id)}
      >
        <WorkspaceViewRouteScope tab={current}>
          {current.surfaceId === "space" ? (
            <SpaceWorkspaceSurface tab={current} />
          ) : current.surfaceId === "agents" || current.surfaceId === "scheduled" ? (
            <AgentsPage />
          ) : (
            <BrowserWorkspace tab={current} />
          )}
        </WorkspaceViewRouteScope>
      </div>
    </RenderErrorBoundary>
  );
}

/** An empty pane: Misty flies around it, as on the welcome screen, behind a line. */
export function EmptyWorkspacePane() {
  return (
    <div className="relative grid h-full place-items-center bg-charcoal-bg px-6 text-center">
      <FlyingMisty />
      <p className="relative z-10 m-0 text-base font-medium text-cream">A little quiet here...</p>
    </div>
  );
}

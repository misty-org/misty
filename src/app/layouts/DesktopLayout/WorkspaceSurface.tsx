import { ExtensionsWorkspace } from "@/features/extensions/ExtensionsWorkspace";
import { SpaceWorkspaceSurface } from "@/features/spaces/SpaceWorkspaceSurface";
import { FilesPage } from "@/features/files/workspace";
import { BrowserWorkspace } from "@/features/browser/workspace";
import { AgentsPage } from "@/features/agents";
import {
  WorkspaceViewRouteScope,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { migrateRetiredWorkspaceView } from "@/features/workspace/workspaceMigrations";
import { RenderErrorBoundary } from "../RenderErrorBoundary";

export function WorkspaceSurface({ tab, active = true }: { tab: WorkspaceView; active?: boolean }) {
  const current = migrateRetiredWorkspaceView(tab);
  return (
    <RenderErrorBoundary key={`${current.id}:${current.surfaceId}`} scope="tab">
      <div
        className="contents"
        onInputCapture={() => useWorkspaceStore.getState().commitPlaceholder(current.id)}
        onClickCapture={() => useWorkspaceStore.getState().commitPlaceholder(current.id)}
      >
        <WorkspaceViewRouteScope tab={current}>
          {current.surfaceId === "extensions" ? (
            <ExtensionsWorkspace />
          ) : current.surfaceId === "space" ? (
            <SpaceWorkspaceSurface tab={current} />
          ) : current.surfaceId === "agents" || current.surfaceId === "scheduled" ? (
            <AgentsPage />
          ) : current.surfaceId === "files" ? (
            <FilesPage
              embedded
              active={active}
              workspaceId={current.id}
              workspaceTitle={current.title}
            />
          ) : (
            <BrowserWorkspace tab={current} />
          )}
        </WorkspaceViewRouteScope>
      </div>
    </RenderErrorBoundary>
  );
}

export function EmptyWorkspacePane() {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg px-6 text-center">
      <p className="m-0 text-base font-medium text-cream">A little quiet here...</p>
    </div>
  );
}

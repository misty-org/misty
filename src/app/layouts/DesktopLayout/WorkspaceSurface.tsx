import { ScheduledPage } from "@/features/scheduled";
import { SpaceWorkspaceSurface } from "@/features/spaces/SpaceWorkspaceSurface";
import { FilesPage } from "@/features/files/workspace";
import { BrowserWorkspace } from "@/features/browser/workspace";
import { HomePage } from "@/features/home";
import { AgentsPage } from "@/features/agents";
import { WorkspaceTabRouteScope, useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { migrateRetiredWorkspaceTab } from "@/features/workspace/workspaceMigrations";
import { Button } from "@/shared/ui";
import { Plus } from "lucide-react";
import { RenderErrorBoundary } from "../RenderErrorBoundary";

export function WorkspaceSurface({ tab, active = true }: { tab: WorkspaceTab; active?: boolean }) {
  const current = migrateRetiredWorkspaceTab(tab);
  return (
    <RenderErrorBoundary key={`${current.id}:${current.surfaceId}`} scope="tab">
      <div
        className="contents"
        onInputCapture={() => useWorkspaceStore.getState().commitPlaceholder(current.id)}
        onClickCapture={() => useWorkspaceStore.getState().commitPlaceholder(current.id)}
      >
        <WorkspaceTabRouteScope tab={current}>
          {current.surfaceId === "home" ? (
            <HomePage />
          ) : current.surfaceId === "space" ? (
            <SpaceWorkspaceSurface tab={current} />
          ) : current.surfaceId === "scheduled" ? (
            <ScheduledPage />
          ) : current.surfaceId === "agents" ? (
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
        </WorkspaceTabRouteScope>
      </div>
    </RenderErrorBoundary>
  );
}

export function EmptyWorkspacePane({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg text-cream-muted">
      <Button variant="outline" onClick={onOpen}>
        <Plus size={16} /> Open a browser tab
      </Button>
    </div>
  );
}

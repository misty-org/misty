import { SpaceWorkspaceSurface } from "@/features/spaces/SpaceWorkspaceSurface";
import FilesPage from "@/features/files/workspace/explorer";
import { BrowserWorkspace } from "@/features/browser/workspace/BrowserWorkspace";
import { AgentsPage } from "@/features/agents";
import { WorkspaceTabRouteScope, type WorkspaceTab } from "@/features/workspace";
import { migrateRetiredWorkspaceTab } from "@/features/workspace/workspaceMigrations";
import { cn, Button } from "@/shared/ui";
import { Plus } from "lucide-react";
import { RenderErrorBoundary } from "../RenderErrorBoundary";

export function WorkspaceSurface({ tab, active = true }: { tab: WorkspaceTab; active?: boolean }) {
  const current = migrateRetiredWorkspaceTab(tab);
  return (
    <RenderErrorBoundary key={`${current.id}:${current.surfaceId}`} scope="tab">
      <WorkspaceTabRouteScope tab={current}>
        {current.surfaceId === "space" ? (
          <SpaceWorkspaceSurface tab={current} />
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
    </RenderErrorBoundary>
  );
}

export function EmptyWorkspacePane({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg text-cream-muted">
      <Button
        variant="ghost"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-charcoal-border",
          "bg-charcoal-card px-4 py-2 text-sm hover:border-charcoal-active hover:text-cream",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted",
        )}
        onClick={onOpen}
      >
        <Plus size={16} /> Open a browser tab
      </Button>
    </div>
  );
}

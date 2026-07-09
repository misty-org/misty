import { SpaceWorkspaceSurface } from "@/features/spaces/SpaceWorkspaceSurface";
import { WorkspaceTabRouteScope, type WorkspaceTab } from "@/features/workspace/core";
import { migrateRetiredWorkspaceTab } from "@/features/workspace/workspaceMigrations";
import { LoadingState } from "@/shared/ui";
import { lazy, Suspense } from "react";

const BrowserWorkspace = lazy(() =>
  import("@/features/browser/workspace/BrowserWorkspace").then((module) => ({
    default: module.BrowserWorkspace,
  })),
);
const MobileFilesPage = lazy(() =>
  import("@/features/files/workspace/mobile/MobileFilesPage").then((module) => ({
    default: module.MobileFilesPage,
  })),
);
const AgentsPage = lazy(() => import("@/features/agents/AgentsPage"));

export function MobileWorkspaceSurface({ tab }: { tab: WorkspaceTab; active?: boolean }) {
  const current = migrateRetiredWorkspaceTab(tab);
  return (
    <WorkspaceTabRouteScope tab={current}>
      <Suspense
        fallback={<LoadingState className="h-full" label="Loading" title="Loading workspace" />}
      >
        {current.surfaceId === "space" ? (
          <SpaceWorkspaceSurface tab={current} />
        ) : current.surfaceId === "agents" ? (
          <AgentsPage />
        ) : current.surfaceId === "files" ? (
          <MobileFilesPage />
        ) : (
          <BrowserWorkspace tab={current} />
        )}
      </Suspense>
    </WorkspaceTabRouteScope>
  );
}

import { lazy, Suspense } from "react";
import type { WorkspaceTab } from "@/features/workspace/model";
import type { MistyFileWorkspaceOptions } from "@misty/sdk";
import { FilePreviewRenderersContext } from "./FilePdfPreview";
import { TrustedAppRouteScope } from "./TrustedAppRouteScope";
const Explorer = lazy(() => import("@/features/files/explorer"));
const Transfers = lazy(() =>
  import("@/features/transfers/TransfersPage").then((module) => ({
    default: module.TransfersWorkspacePanel,
  })),
);

/** Shared Files UI retains the native stores, disks, peer connections, and SQLite queue. */
export function FileWorkspaceSurface({
  tab,
  options,
}: {
  tab: WorkspaceTab;
  options: MistyFileWorkspaceOptions;
}) {
  const transfers = options.view === "transfers";
  return (
    <TrustedAppRouteScope
      appId="files"
      spaceId=""
      route={transfers ? "/apps/files?view=transfers" : "/apps/files"}
    >
      <FilePreviewRenderersContext.Provider value={options}>
        <div
          className="relative h-full min-h-0 bg-charcoal-bg"
          data-misty-file-workspace={options.view}
        >
          <Suspense
            fallback={<div role="status">Opening {transfers ? "Transfers" : "Explorer"}…</div>}
          >
            {!transfers && (
              <div className="h-full">
                <Explorer
                  embedded
                  active={!transfers && options.active !== false}
                  workspaceId={tab.id}
                  workspaceTitle="Explorer"
                />
              </div>
            )}
            {transfers && (
              <div className="absolute inset-0">
                <Transfers workspaceId={tab.id} />
              </div>
            )}
          </Suspense>
        </div>
      </FilePreviewRenderersContext.Provider>
    </TrustedAppRouteScope>
  );
}

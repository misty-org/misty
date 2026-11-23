import {
  PaneLoading,
  SetupState,
  SidePanelHeader,
  Skeleton,
  SkeletonControl,
  Text,
} from "@misty/ui";
import { StepsSkeleton } from "../activity/StepsSkeleton";
import type { ContextPanelSurface } from "./context_panel_store";
import { fileName } from "./files/paths";

const nameWidths = ["w-2/5", "w-1/2", "w-1/3", "w-3/5", "w-1/4", "w-2/5", "w-1/2", "w-1/3"];

export function FolderToolsSkeleton() {
  return (
    <SidePanelHeader>
      <div
        className="flex flex-none items-center gap-0.5"
        data-side-panel-trailing=""
        aria-hidden="true"
      >
        <SkeletonControl kind="icon" />
        <SkeletonControl kind="icon" />
        <Skeleton className="h-8 w-12.5 shrink-0 rounded-md" />
      </div>
    </SidePanelHeader>
  );
}

export function FileTreeSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Files" aria-busy="true" className="grid px-1">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`flex h-8 items-center gap-1.5 pr-1 ${index === 0 ? "pl-2" : "pl-5.5"}`}
        >
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton
            className={`h-3 rounded-sm ${index === 0 ? "w-1/4" : nameWidths[index % nameWidths.length]}`}
          />
        </div>
      ))}
    </div>
  );
}

export function EditorSkeleton({ path }: { path: string }) {
  const name = fileName(path);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3 text-meta">
        <Text tone="default">{name}</Text>
      </div>
      <PaneLoading label={`Loading ${name}`} />
    </div>
  );
}

export function ChangesSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Changes" aria-busy="true" className="grid">
      <div className="flex h-8 items-center gap-1.5 px-3">
        <Skeleton className="h-3 w-20 rounded-sm" />
        <Skeleton className="h-3 w-6 rounded-sm" />
        <Skeleton className="h-3 w-6 rounded-sm" />
      </div>
      <div className="flex h-8 items-center gap-1.5 pr-1.5 pl-1">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <div className="flex-1">
          <Skeleton className="h-3 w-24 rounded-sm" />
        </div>
        <Skeleton className="h-3 w-14 shrink-0 rounded-sm" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-8 items-center gap-1.5 pr-2 pl-3">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className="h-3 w-3.5 shrink-0 rounded-sm" />
          <div className="min-w-0 flex-1">
            <Skeleton className={`h-3 rounded-sm ${nameWidths[index % nameWidths.length]}`} />
          </div>
          <Skeleton className="h-3 w-10 shrink-0 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

function ChangesHeadSkeleton() {
  return (
    <SidePanelHeader>
      <div className="flex min-w-0 flex-1 items-center gap-1" aria-hidden="true">
        <Skeleton className="h-8 w-32 min-w-0 rounded-md" />
        <div className="ml-auto flex items-center gap-0.5">
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="icon" />
        </div>
      </div>
    </SidePanelHeader>
  );
}

function TerminalSkeleton() {
  return <SetupState tool="terminal" />;
}

export function ContextPanelSkeleton({
  tab,
  tools = true,
}: {
  tab: ContextPanelSurface;
  tools?: boolean;
}) {
  if (tab === "steps") return <StepsSkeleton />;
  return (
    <>
      {tools ? <FolderToolsSkeleton /> : null}
      {tab === "files" ? (
        <div className="py-1">
          <FileTreeSkeleton />
        </div>
      ) : tab === "changes" ? (
        <>
          <ChangesHeadSkeleton />
          <ChangesSkeleton />
        </>
      ) : (
        <TerminalSkeleton />
      )}
    </>
  );
}

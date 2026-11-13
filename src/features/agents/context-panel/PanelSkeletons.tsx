import {
  SidePanelHeader,
  Skeleton,
  SkeletonCode,
  SkeletonControl,
  SkeletonDocument,
  Text,
} from "@/shared/ui";
import { StepsSkeleton } from "../activity/StepsSkeleton";
import type { ContextPanelSurface } from "./contextPanelStore";
import { canPreviewFile, opensInPreview } from "./editor/editorViewMode";
import { fileName } from "./files/paths";

/*
 * The context panel's first paint, before a view's code or its first read has arrived: each one
 * shaped like the view that replaces it, row for row, so nothing moves when it does.
 */

const nameWidths = ["w-2/5", "w-1/2", "w-1/3", "w-3/5", "w-1/4", "w-2/5", "w-1/2", "w-1/3"];

/** The folder's tools at the end of the panel's header row: worktrees, the launch script, and
 * the app the folder opens in (an icon with its menu's chevron). */
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

/** The file tree's rows: the folder's own row, then its top level, one indent in. It sits in the
 * tree's scroll area, which has the rows' top and bottom inset. */
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

/**
 * An open file before its text is first read: the editor's bar with the file's own name, its
 * switches and Save, then lines of code, or a page for a file that opens rendered.
 */
export function EditorSkeleton({ path }: { path: string }) {
  const name = fileName(path);
  const preview = canPreviewFile(name) && opensInPreview(name);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3 text-meta">
        <Text tone="default">{name}</Text>
        <div className="flex-1" />
        {canPreviewFile(name) ? <Skeleton className="h-8 w-32 shrink-0 rounded-lg" /> : null}
        {preview ? null : <SkeletonControl kind="icon" />}
        <SkeletonControl kind="button" />
      </div>
      {preview ? <SkeletonDocument label={name} /> : <SkeletonCode label={name} lines={20} />}
    </div>
  );
}

/** The Git changes list: the summary bar, a group's head, then its file rows (tick, letter,
 * name, line counts). */
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

/** The changes view's header row: the branch, then list or tree, refresh, pull and push. */
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

/** A terminal starting: its first tab in the header row, and one prompt line. */
function TerminalSkeleton() {
  return (
    <>
      <SidePanelHeader>
        <div className="flex min-w-0 flex-1 items-center" aria-hidden="true">
          <Skeleton className="h-6.5 w-24 rounded-md" />
        </div>
      </SidePanelHeader>
      <div role="status" aria-label="Terminal" aria-busy="true" className="pt-3 pr-1.5 pl-3.5">
        <Skeleton className="h-3 w-2/5 rounded-sm" />
      </div>
    </>
  );
}

/** The preview: its address field in the header row, and a page. */
function PreviewSkeleton() {
  return (
    <>
      <SidePanelHeader>
        <div className="flex min-w-0 flex-1 items-center gap-1" aria-hidden="true">
          <Skeleton className="h-8 min-w-0 flex-1 rounded-lg" />
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="button" className="w-36" />
        </div>
      </SidePanelHeader>
      <SkeletonDocument label="Preview" />
    </>
  );
}

/**
 * The open view's skeleton, with the folder's tools in the header for the views a folder has.
 * `tools` is false where the panel already shows them.
 */
export function ContextPanelSkeleton({
  tab,
  tools = true,
}: {
  tab: ContextPanelSurface;
  tools?: boolean;
}) {
  if (tab === "steps") return <StepsSkeleton />;
  if (tab === "preview") return <PreviewSkeleton />;
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

/** The session card: how full the context is (a row and its meter), then where the chat works. */
export function SessionSkeleton() {
  const head = (width: string) => (
    <div className="flex min-h-6 items-center gap-1.5">
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <Skeleton className="h-3 w-12 rounded-sm" />
      <Skeleton className={`ml-auto h-3 rounded-sm ${width}`} />
    </div>
  );
  const row = (width: string) => (
    <div className="flex h-6 items-center gap-2">
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <div className="flex-1">
        <Skeleton className={`h-3 rounded-sm ${width}`} />
      </div>
      <Skeleton className="h-3 w-12 shrink-0 rounded-sm" />
    </div>
  );
  return (
    <div
      role="status"
      aria-label="Session"
      aria-busy="true"
      className="grid gap-4 px-3 pt-2.5 pb-3"
    >
      <div className="grid">
        {head("w-20")}
        {row("w-1/3")}
        <Skeleton className="mt-0.5 mb-1 h-1 rounded-full" />
      </div>
      <div className="grid">
        {head("w-24")}
        {row("w-1/4")}
        {row("w-2/5")}
        {row("w-1/3")}
      </div>
    </div>
  );
}

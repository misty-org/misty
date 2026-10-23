import type { AiSurfaceAdapter } from "@/features/ai-surface/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import { JournalDeleteDialog } from "@/features/journal";
import {
  Button,
  CollectionItemDialog,
  CollectionSkeleton,
  EmptyState,
  PermissionState,
} from "@/shared/ui";
import { DrawingCollection } from "./components/DrawingCollection";
import { DrawingCanvasSkeleton, DrawingWorkspace } from "./components/DrawingWorkspace";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams, type NavigateOptions } from "react-router-dom";
import type { DrawingHeader } from "./components/DrawingHeader";
import type { DrawingPreviewHeader } from "./components/DrawingPreviewHeader";
import type { NewDrawingDialog } from "./components/NewDrawingDialog";
import type { useDrawingRoomView, DrawingUser } from "./hooks/useDrawingRoomView";
import type { useSpaceDrawingsView } from "./hooks/useSpaceDrawingsView";
import type { SpaceDrawing } from "./types";
import type { CollaborativeDrawingCanvasProps } from "./components/CollaborativeDrawingCanvasView";

export interface DrawingsViewRuntime {
  readOnly?: boolean;
  user: DrawingUser | null;
  members: readonly { user_id: string; name?: string | null }[];
  useList(space: string): ReturnType<typeof useSpaceDrawingsView>;
  useRoom(
    space: string,
    id: string,
    user: DrawingUser,
    options?: { publishPresence?: boolean },
  ): ReturnType<typeof useDrawingRoomView>;
  renderTitle(title: string, workspaceTabId?: string): ReactNode;
  renderAiRegistration(adapter: AiSurfaceAdapter): ReactNode;
  renderError(error: string, scope: string, title: string): ReactNode;
  Header: ComponentType<ComponentProps<typeof DrawingHeader>>;
  PreviewHeader: ComponentType<ComponentProps<typeof DrawingPreviewHeader>>;
  Preview: ComponentType<{ drawing: SpaceDrawing; user: DrawingUser }>;
  NewDialog: ComponentType<ComponentProps<typeof NewDrawingDialog>>;
  Canvas: ComponentType<Omit<CollaborativeDrawingCanvasProps, "runtime">>;
}

export function SpaceDrawingsView(props: {
  runtime: DrawingsViewRuntime;
  spaceId: string;
  drawingId: string;
  workspaceTabId?: string;
}) {
  const { runtime } = props;
  const { user, NewDialog: NewDrawingDialog } = runtime;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const drawings = runtime.useList(props.spaceId);
  const requestedView = searchParams.get("view");
  const view = props.drawingId && requestedView !== "list" ? "canvas" : "list";
  const [query, setQuery] = useState("");
  const [newDrawingOpen, setNewDrawingOpen] = useState(false);
  const pendingCreation = useRef<string | true | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SpaceDrawing | null>(null);
  const [renameTarget, setRenameTarget] = useState<SpaceDrawing | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState("");
  const selected = drawings.drawings.find((drawing) => drawing.id === props.drawingId);

  const navigateToDrawing = useCallback(
    (drawingId: string, nextView: "canvas" | "list", options?: NavigateOptions) => {
      const next = new URLSearchParams(searchParams);
      next.set("view", nextView);
      navigate(
        {
          pathname: drawingPath(props.spaceId, drawingId),
          search: `?${next.toString()}`,
        },
        options,
      );
    },
    [navigate, props.spaceId, searchParams],
  );

  const navigateToDrawingList = useCallback(
    (options?: NavigateOptions) => {
      const next = new URLSearchParams(searchParams);
      next.delete("view");
      navigate(
        {
          pathname: `/spaces/${encodeURIComponent(props.spaceId)}/drawings`,
          search: next.size ? `?${next.toString()}` : "",
        },
        options,
      );
    },
    [navigate, props.spaceId, searchParams],
  );

  useEffect(() => {
    if (pendingCreation.current === props.drawingId) pendingCreation.current = null;
    if (pendingCreation.current) return;
    if (drawings.loading || drawings.drawings.length === 0 || selected) return;
    navigateToDrawing(drawings.drawings[0].id, view, { replace: true });
  }, [drawings.drawings, drawings.loading, navigateToDrawing, props.drawingId, selected, view]);

  const orderedDrawings = useMemo(
    () =>
      [...drawings.drawings].sort(
        (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
      ),
    [drawings.drawings],
  );
  const filteredDrawings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orderedDrawings;
    return orderedDrawings.filter((drawing) => drawing.title.toLowerCase().includes(q));
  }, [orderedDrawings, query]);
  const removeDrawing = useCallback(async () => {
    if (!deleteTarget) return;
    await drawings.remove(deleteTarget.id);
    if (deleteTarget.id === selected?.id) {
      navigateToDrawingList({ replace: true });
    }
  }, [deleteTarget, drawings, navigateToDrawingList, selected?.id]);
  const deleteManyDrawings = async (ids: string[]) => {
    if (bulkDeleting || runtime.readOnly || !ids.length) return;
    const selectedDrawings = ids
      .map((id) => drawings.drawings.find((drawing) => drawing.id === id))
      .filter((drawing): drawing is SpaceDrawing => Boolean(drawing?.can_delete));
    if (!selectedDrawings.length) return;
    if (
      !(await confirmAction(
        `Permanently delete ${selectedDrawings.length} selected ${selectedDrawings.length === 1 ? "drawing" : "drawings"}?`,
      ))
    )
      return;
    setBulkDeleting(true);
    setBulkDeleteError("");
    try {
      for (const drawing of selectedDrawings) await drawings.remove(drawing.id);
      if (selectedDrawings.some((drawing) => drawing.id === selected?.id))
        navigateToDrawingList({ replace: true });
    } catch {
      setBulkDeleteError("Some selected drawings couldn't be deleted. Try again.");
    } finally {
      setBulkDeleting(false);
    }
  };

  if (!user) {
    return (
      <PermissionState
        className="h-full"
        title="Sign in to open drawings"
        description="Collaborative drawings require an active Misty session."
      />
    );
  }

  if (drawings.loading && drawings.drawings.length === 0) {
    return <CollectionSkeleton label="Drawings" view="grid" className="h-full p-6" />;
  }

  if (drawings.error) {
    return (
      <>
        {runtime.renderError(
          drawings.error,
          `drawings:${props.spaceId}:list`,
          "Drawings could not be loaded",
        )}
        <EmptyState
          className="h-full"
          title="Drawings are unavailable"
          description="They couldn't be loaded. Try again."
          action={
            <Button type="button" onClick={() => void drawings.reload()}>
              Try again
            </Button>
          }
        />
      </>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream">
      {runtime.renderTitle(selected?.title?.trim() || "Drawings", props.workspaceTabId)}
      {view === "list" ? (
        <DrawingCollection
          readOnly={runtime.readOnly}
          spaceId={props.spaceId}
          drawings={filteredDrawings}
          query={query}
          onQuery={setQuery}
          onOpen={(drawing) => navigateToDrawing(drawing.id, "canvas")}
          onCreate={() => setNewDrawingOpen(true)}
          onDelete={setDeleteTarget}
          onDeleteMany={(ids) => void deleteManyDrawings(ids)}
          bulkBusy={bulkDeleting}
          bulkError={bulkDeleteError}
          onRename={setRenameTarget}
        />
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {selected ? (
            <DrawingWorkspace
              runtime={runtime}
              key={selected.id}
              drawing={selected}
              onBack={() => navigateToDrawing(selected.id, "list")}
              user={user}
              onRename={(title) => drawings.rename(selected.id, title).then(() => undefined)}
            />
          ) : (
            <DrawingCanvasSkeleton label="Opening drawing" />
          )}
        </div>
      )}

      <NewDrawingDialog
        open={newDrawingOpen}
        onOpenChange={setNewDrawingOpen}
        onCreate={async (title) => {
          pendingCreation.current = true;
          try {
            const drawing = await drawings.create(title);
            pendingCreation.current = drawing.id;
            navigateToDrawing(drawing.id, "canvas");
          } catch (error) {
            pendingCreation.current = null;
            throw error;
          }
        }}
      />
      {renameTarget && renameTarget.space_id === props.spaceId && (
        <CollectionItemDialog
          key={renameTarget.id}
          title="Rename drawing"
          initialName={renameTarget.title}
          actionLabel="Save"
          onConfirm={(title) => {
            const current = drawings.drawings.find((drawing) => drawing.id === renameTarget.id);
            if (runtime.readOnly || !current || current.role === "viewer")
              return Promise.reject(
                new Error("You no longer have permission to rename this drawing."),
              );
            return drawings.rename(current.id, title);
          }}
          onClose={() => setRenameTarget(null)}
        />
      )}
      <JournalDeleteDialog
        kind="drawing"
        title={deleteTarget?.title ?? ""}
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={removeDrawing}
      />
    </div>
  );
}

function drawingPath(spaceId: string, drawingId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/drawings/${encodeURIComponent(drawingId)}`;
}

import type { AiSurfaceAdapter } from "@/features/agents";
import { JournalDeleteDialog } from "..";
import { EmptyState, Surface, Text } from "@misty/ui";
import { DrawingCanvasSkeleton, DrawingWorkspace } from "./components/DrawingWorkspace";
import {
  useCallback,
  useState,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { DrawingHeader } from "./components/DrawingHeader";
import type { DrawingPreviewHeader } from "./components/DrawingPreviewHeader";
import type { NewDrawingDialog } from "./components/NewDrawingDialog";
import type { useDrawingRoomView, DrawingUser } from "./hooks/useDrawingRoomView";
import type { useSpaceDrawingsView } from "./hooks/useSpaceDrawingsView";
import type { SpaceDrawing } from "./drawingTypes";
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

/**
 * One open whiteboard. The Whiteboards page itself (its collection) is the Space's home narrowed
 * to whiteboards, which opens this only for a whiteboard's own address.
 */
export function SpaceDrawingsView(props: {
  runtime: DrawingsViewRuntime;
  spaceId: string;
  drawingId: string;
  workspaceTabId?: string;
}) {
  const { runtime } = props;
  const { user } = runtime;
  const navigate = useNavigate();
  const drawings = runtime.useList(props.spaceId);
  const [deleteTarget, setDeleteTarget] = useState<SpaceDrawing | null>(null);
  const selected = drawings.drawings.find((drawing) => drawing.id === props.drawingId);

  const leaveForPage = useCallback(
    (replace = false) =>
      navigate(`/spaces/${encodeURIComponent(props.spaceId)}/drawings`, { replace }),
    [navigate, props.spaceId],
  );
  const removeDrawing = useCallback(async () => {
    if (!deleteTarget) return;
    await drawings.remove(deleteTarget.id);
    if (deleteTarget.id === selected?.id) leaveForPage(true);
  }, [deleteTarget, drawings, leaveForPage, selected?.id]);

  if (!user) {
    return <EmptyState title="Sign in to open whiteboards" line="Sign in to draw with others." />;
  }

  if (drawings.error) {
    return (
      <>
        {runtime.renderError(
          drawings.error,
          `drawings:${props.spaceId}:list`,
          "Whiteboards could not be loaded",
        )}
        <EmptyState
          title="Whiteboards are unavailable"
          line="They couldn't be loaded. Try again."
          action={{ label: "Try again", onClick: () => void drawings.reload() }}
        />
      </>
    );
  }

  if (!props.drawingId) return null;

  return (
    <Surface tone="page" className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <Text bare as="div" tone="default" className="contents">
        {runtime.renderTitle(selected?.title?.trim() || "Whiteboards", props.workspaceTabId)}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {selected ? (
            <DrawingWorkspace
              runtime={runtime}
              key={selected.id}
              drawing={selected}
              onBack={() => leaveForPage()}
              user={user}
              onRename={(title) => drawings.rename(selected.id, title).then(() => undefined)}
              onDelete={
                runtime.readOnly || !selected.can_delete
                  ? undefined
                  : () => setDeleteTarget(selected)
              }
              onOpenDrawing={
                runtime.readOnly
                  ? undefined
                  : (drawingId) =>
                      navigate(
                        `/spaces/${encodeURIComponent(props.spaceId)}/drawings/${encodeURIComponent(drawingId)}`,
                      )
              }
            />
          ) : drawings.loading ? (
            <DrawingCanvasSkeleton label="Opening whiteboard" header />
          ) : (
            <EmptyState
              title="This whiteboard isn’t available"
              line="It may have been deleted, or you may no longer have access."
              action={{ label: "Back to whiteboards", onClick: () => leaveForPage(true) }}
            />
          )}
        </div>
        <JournalDeleteDialog
          kind="drawing"
          title={deleteTarget?.title ?? ""}
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onConfirm={removeDrawing}
        />
      </Text>
    </Surface>
  );
}

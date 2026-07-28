import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, PermissionState, Spinner } from "@/ui";
import { useAuth, type AuthUser } from "@/features/auth/AuthContext";
import { useSpaceDrawings } from "./hooks/useSpaceDrawings";
import { useDrawingRoom } from "./hooks/useDrawingRoom";
import { DrawingHeader } from "./components/DrawingHeader";
import { NewDrawingDialog } from "./components/NewDrawingDialog";
import type { SpaceDrawing } from "./types";

const CollaborativeDrawingCanvas = lazy(() => import("./components/CollaborativeDrawingCanvas"));

export function SpaceDrawings(props: { spaceId: string; drawingId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const drawings = useSpaceDrawings(props.spaceId);
  const [newDrawingOpen, setNewDrawingOpen] = useState(false);
  const selected = drawings.drawings.find((drawing) => drawing.id === props.drawingId);

  useEffect(() => {
    if (drawings.loading || drawings.drawings.length === 0 || selected) return;
    navigate(drawingPath(props.spaceId, drawings.drawings[0].id), {
      replace: true,
    });
  }, [drawings.drawings, drawings.loading, navigate, props.spaceId, selected]);

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
    return <DrawingLoading label="Loading drawings" />;
  }

  if (drawings.error) {
    return (
      <EmptyState
        className="h-full"
        title="Drawings are unavailable"
        description={drawings.error}
        action={
          <Button type="button" onClick={() => void drawings.reload()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (drawings.drawings.length === 0) {
    return (
      <>
        <EmptyState
          className="h-full"
          title="Sketch ideas together"
          description="Create a live canvas for diagrams, planning, and visual collaboration."
          action={
            <Button type="button" onClick={() => setNewDrawingOpen(true)}>
              Create drawing
            </Button>
          }
        />
        <NewDrawingDialog
          open={newDrawingOpen}
          onOpenChange={setNewDrawingOpen}
          onCreate={async (title) => {
            const drawing = await drawings.create(title);
            navigate(drawingPath(props.spaceId, drawing.id));
          }}
        />
      </>
    );
  }

  if (!selected) return <DrawingLoading label="Opening drawing" />;

  return (
    <DrawingWorkspace
      key={selected.id}
      drawing={selected}
      user={user}
      onRename={(title) => drawings.rename(selected.id, title).then(() => undefined)}
      onDelete={async () => {
        await drawings.remove(selected.id);
        navigate(`/spaces/${encodeURIComponent(props.spaceId)}/drawings`, {
          replace: true,
        });
      }}
    />
  );
}

function DrawingWorkspace(props: {
  drawing: SpaceDrawing;
  user: AuthUser;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const room = useDrawingRoom(props.drawing.space_id, props.drawing.id, props.user);
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <DrawingHeader
        drawing={props.drawing}
        connection={room.connection}
        onRename={props.onRename}
        onDelete={props.onDelete}
      />
      <div className="relative min-h-0 overflow-hidden">
        {room.error ? (
          <EmptyState
            className="h-full"
            title="Could not join this drawing"
            description={room.error}
          />
        ) : room.session && room.synced ? (
          <Suspense fallback={<DrawingLoading label="Preparing canvas" />}>
            <CollaborativeDrawingCanvas drawing={props.drawing} session={room.session} />
          </Suspense>
        ) : (
          <DrawingLoading label="Joining live canvas" />
        )}
      </div>
    </div>
  );
}

function DrawingLoading({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {label}…
      </div>
    </div>
  );
}

function drawingPath(spaceId: string, drawingId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/drawings/${encodeURIComponent(drawingId)}`;
}

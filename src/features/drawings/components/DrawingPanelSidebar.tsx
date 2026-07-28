import { FilePenLine, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Skeleton, cn } from "@/ui";
import { useSpaceDrawings } from "../hooks/useSpaceDrawings";
import { NewDrawingDialog } from "./NewDrawingDialog";

export function DrawingPanelSidebar(props: { spaceId: string; activeDrawingId: string }) {
  const navigate = useNavigate();
  const drawings = useSpaceDrawings(props.spaceId);
  const [newDrawingOpen, setNewDrawingOpen] = useState(false);

  return (
    <>
      <section className="grid gap-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-medium text-sidebar-foreground">Drawings</h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            title="New drawing"
            aria-label="New drawing"
            onClick={() => setNewDrawingOpen(true)}
          >
            <Plus size={15} />
          </Button>
        </div>

        <nav className="grid gap-1" aria-label="Space drawings">
          {drawings.loading && drawings.drawings.length === 0
            ? Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-9 rounded-lg" />
              ))
            : drawings.drawings.map((drawing) => (
                <Button
                  key={drawing.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-9 min-w-0 justify-start gap-2 rounded-lg px-2 text-left text-xs font-normal",
                    props.activeDrawingId === drawing.id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                  )}
                  onClick={() =>
                    navigate(
                      `/spaces/${encodeURIComponent(props.spaceId)}/drawings/${encodeURIComponent(drawing.id)}`,
                    )
                  }
                >
                  <FilePenLine size={15} className="shrink-0" />
                  <span className="truncate">{drawing.title}</span>
                </Button>
              ))}
        </nav>

        {!drawings.loading && drawings.drawings.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            Create a drawing to sketch ideas together.
          </p>
        ) : null}
      </section>

      <NewDrawingDialog
        open={newDrawingOpen}
        onOpenChange={setNewDrawingOpen}
        onCreate={async (title) => {
          const drawing = await drawings.create(title);
          navigate(
            `/spaces/${encodeURIComponent(props.spaceId)}/drawings/${encodeURIComponent(drawing.id)}`,
          );
        }}
      />
    </>
  );
}

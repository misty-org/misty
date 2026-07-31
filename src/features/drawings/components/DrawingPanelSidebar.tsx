import { FilePenLine, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Skeleton, cn } from "@/ui";
import { SpaceSidebarSection } from "@/features/spaces/components/SpaceSidebarSection";
import { useSpaceDrawings } from "../hooks/useSpaceDrawings";
import { NewDrawingDialog } from "./NewDrawingDialog";

export function DrawingPanelSidebar(props: { spaceId: string; activeDrawingId: string }) {
  const navigate = useNavigate();
  const drawings = useSpaceDrawings(props.spaceId);
  const [newDrawingOpen, setNewDrawingOpen] = useState(false);

  return (
    <>
      <SpaceSidebarSection
        title="Drawings"
        count={drawings.drawings.length}
        action={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 shrink-0 opacity-0 shadow-none group-hover/sidebar-header:opacity-100 focus-visible:opacity-100"
            title="New drawing"
            aria-label="New drawing"
            onClick={() => setNewDrawingOpen(true)}
          >
            <Plus size={13} />
          </Button>
        }
      >
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
                    "misty-hover-marker-side relative h-9 min-w-0 justify-start gap-2 rounded-md px-3 text-left text-xs font-normal",
                    props.activeDrawingId === drawing.id
                      ? "misty-active-marker-side text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:text-sidebar-accent-foreground",
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
          <p className="px-2 py-1 text-[11px] text-muted-foreground">None yet</p>
        ) : null}
      </SpaceSidebarSection>

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

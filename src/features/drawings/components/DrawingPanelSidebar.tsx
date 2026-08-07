import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, Skeleton, cn } from "@/ui";
import { SpaceSidebarSection } from "@/features/spaces/components/SpaceSidebarSection";
import { SpaceSidebarPageSection } from "@/features/spaces/components/SpaceSidebarPageSection";
import { useSpaceDrawings } from "../hooks/useSpaceDrawings";
import { NewDrawingDialog } from "./NewDrawingDialog";

export function DrawingPanelSidebar(props: {
  spaceId: string;
  activeDrawingId: string;
  section?: { active: boolean; to: string };
}) {
  const navigate = useNavigate();
  const drawings = useSpaceDrawings(props.spaceId);
  const [newDrawingOpen, setNewDrawingOpen] = useState(false);

  const action = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-6 shrink-0 opacity-0 shadow-none group-hover/sidebar-page:opacity-100 group-hover/sidebar-header:opacity-100 focus-visible:opacity-100"
      title="New drawing"
      aria-label="New drawing"
      onClick={() => setNewDrawingOpen(true)}
    >
      <Plus size={13} />
    </Button>
  );
  const content = (
    <>
      <nav className="grid gap-1" aria-label="Space drawings">
        {drawings.loading && drawings.drawings.length === 0
          ? Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-9 rounded-lg" />
            ))
          : drawings.drawings.map((drawing) => (
              <ContextMenu key={drawing.id}>
                <ContextMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      "misty-marker-host relative h-9 min-w-0 justify-start gap-2 rounded-md px-3 text-left text-xs font-normal",
                      props.activeDrawingId === drawing.id
                        ? "misty-active-marker-side text-cream-bright font-medium"
                        : "text-cream-muted hover:text-cream",
                    )}
                    onClick={() =>
                      navigate(
                        `/spaces/${encodeURIComponent(props.spaceId)}/drawings/${encodeURIComponent(drawing.id)}`,
                      )
                    }
                  >
                    <span className="truncate">{drawing.title}</span>
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-44 text-xs">
                  <ContextMenuItem
                    className="text-cream-bright focus:bg-charcoal-active focus:text-cream-bright"
                    onClick={async () => {
                      if (window.confirm(`Delete “${drawing.title}”?`)) {
                        await drawings.remove(drawing.id);
                      }
                    }}
                  >
                    Delete drawing
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
      </nav>

      {!drawings.loading && drawings.drawings.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-cream-muted">None yet</p>
      ) : null}
    </>
  );

  return (
    <>
      {props.section ? (
        <SpaceSidebarPageSection
          active={props.section.active}
          label="Drawings"
          to={props.section.to}
          count={drawings.drawings.length}
          action={action}
        >
          {content}
        </SpaceSidebarPageSection>
      ) : (
        <SpaceSidebarSection title="Drawings" count={drawings.drawings.length} action={action}>
          {content}
        </SpaceSidebarSection>
      )}

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

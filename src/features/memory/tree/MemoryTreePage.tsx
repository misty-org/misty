import { ReactFlowProvider } from "@xyflow/react";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useRecapRequest } from "../recall";
import { Button, cn, EmptyState, ErrorState, Pressable } from "@/shared/ui";
import { AddMemoryDialog } from "./AddMemoryDialog";
import { ForgetDialog } from "./ForgetDialog";
import { MemoryTreeCanvas } from "./MemoryTreeCanvas";
import { MemoryTreeSkeleton } from "./MemoryTreeSkeleton";
import { MemoryTreeToolbar } from "./MemoryTreeToolbar";
import { RecapSheet } from "./RecapSheet";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

const DRAWER_MS = 220;
const drawerWidth = "w-[min(27.5rem,45vw)]";

const drawerHandle =
  "absolute inset-y-0 right-0 z-10 my-auto flex h-16 w-6 items-center justify-center " +
  "rounded-l-lg border border-r-0 border-charcoal-border bg-charcoal-card text-cream-muted " +
  "hover:bg-charcoal-hover hover:text-cream-bright";

/** The Forget dialog for whichever node asked, from a node's menu or the toolbar. */
function ForgetHost() {
  const target = useMemoryTreeStore((s) => s.forgetTarget);
  const askForget = useMemoryTreeStore((s) => s.askForget);
  if (!target) return null;
  return (
    <ForgetDialog
      nodeId={target.id}
      label={target.label}
      open
      onOpenChange={(open) => !open && askForget(null)}
    />
  );
}

/** The Add dialog, opened from the toolbar or a branch's menu. */
function AddHost() {
  const branch = useMemoryTreeStore((s) => s.addTarget);
  return branch ? <AddMemoryDialog key={branch} branch={branch} /> : null;
}

/** What a Space remembers, as a tree you can open, search, and forget from. */
export function MemoryTreePage({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const status = useMemoryTreeStore((s) => s.status);
  const empty = useMemoryTreeStore(
    (s) => s.status === "ready" && (s.children[""] ?? []).every((n) => n.count === 0),
  );
  const open = useMemoryTreeStore((s) => s.open);
  const refresh = useMemoryTreeStore((s) => s.refresh);
  const requestedDay = useRecapRequest((s) => s.day);
  const [recap, setRecap] = useState<{ day: string | null } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The drawer mounts closed and opens on the next frame, so its width has something to animate.
  useEffect(() => {
    if (!recap) return;
    const frame = requestAnimationFrame(() => setDrawerOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [recap]);

  // Closed, it stays until it has finished sliding away.
  useEffect(() => {
    if (!recap || drawerOpen) return;
    const timer = window.setTimeout(() => setRecap(null), DRAWER_MS);
    return () => window.clearTimeout(timer);
  }, [recap, drawerOpen]);

  useEffect(() => {
    void open(spaceId);
  }, [open, spaceId]);

  useEffect(() => {
    if (!requestedDay) return;
    setRecap({ day: requestedDay });
    useRecapRequest.setState({ day: null });
  }, [requestedDay]);

  let body;
  if (status === "error")
    body = (
      <ErrorState
        className="h-full"
        title="Memory couldn't be loaded"
        action={<Button onClick={() => void refresh()}>Try again</Button>}
      />
    );
  else if (status === "loading") body = <MemoryTreeSkeleton />;
  else if (empty)
    body = (
      <EmptyState
        className="h-full"
        title="Nothing remembered yet"
        description="Pages you read, things you say and tabs you open will grow here."
        action={
          <Button onClick={() => useMemoryTreeStore.getState().askAdd("facts")}>
            Add a memory
          </Button>
        }
      />
    );
  else
    body = (
      <ReactFlowProvider>
        <MemoryTreeCanvas spaceName={spaceName} />
      </ReactFlowProvider>
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-charcoal-bg">
      <MemoryTreeToolbar />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {body}
          {status !== "error" && !drawerOpen && (
            <Pressable
              aria-label="Open recap"
              title="Recap"
              onClick={() => setRecap({ day: null })}
              className={drawerHandle}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Pressable>
          )}
        </div>
        {status !== "error" && recap && (
          <div
            inert={!drawerOpen}
            style={{ transitionDuration: `${DRAWER_MS}ms` }}
            className={cn(
              "shrink-0 overflow-hidden transition-[width] ease-out motion-reduce:transition-none",
              drawerOpen ? drawerWidth : "w-0",
            )}
          >
            <RecapSheet
              key={spaceId}
              spaceId={spaceId}
              startDay={recap.day}
              className={drawerWidth}
              onClose={() => setDrawerOpen(false)}
            />
          </div>
        )}
      </div>
      <ForgetHost />
      <AddHost />
    </div>
  );
}

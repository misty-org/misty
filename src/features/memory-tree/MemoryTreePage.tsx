import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { Button, EmptyState, ErrorState } from "@/shared/ui";
import { AddMemoryDialog } from "./AddMemoryDialog";
import { CaptureControl } from "./CaptureControl";
import { ForgetDialog } from "./ForgetDialog";
import { MemoryTreeCanvas } from "./MemoryTreeCanvas";
import { MemoryTreeSkeleton } from "./MemoryTreeSkeleton";
import { MemoryTreeToolbar } from "./MemoryTreeToolbar";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

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

  useEffect(() => {
    void open(spaceId);
  }, [open, spaceId]);

  let body;
  if (status === "unavailable")
    body = (
      <EmptyState
        className="h-full"
        title="Memory isn't available yet"
        description="It isn't turned on for this Misty server."
      />
    );
  else if (status === "error")
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
        description="Pages you read, things you say and screens you capture will grow here."
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
      <MemoryTreeToolbar spaceName={spaceName} />
      <div className="relative min-h-0 flex-1">
        {body}
        {status !== "unavailable" && status !== "error" && <CaptureControl />}
      </div>
      <ForgetHost />
      <AddHost />
    </div>
  );
}

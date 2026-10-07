import { DragPreviewCard } from "@/shared/ui";
import type { ExplorerDragViewState } from "@/features/file-ui";

export function ExplorerDragPreview({ state }: { state: ExplorerDragViewState }) {
  // Internal drags lift the row itself; the card only appears for files dragged
  // in from the OS, or while files are being prepared to leave the app.
  if (!state.payload || !state.pointer || state.phase === "native-egress") return null;
  if (state.payload.origin === "internal" && !state.preparing) return null;
  const itemCount = `${state.payload.items.length} item${state.payload.items.length === 1 ? "" : "s"}`;
  const label = state.preparing ? `${itemCount} · Preparing…` : itemCount;
  return (
    <DragPreviewCard
      style={{ left: state.pointer.x + 14, top: state.pointer.y + 16 }}
      role="status"
      aria-live="polite"
    >
      <div className="truncate">{state.payload.items[0]?.name}</div>
      <div className="mt-0.5 text-[10px] font-medium opacity-65">{label}</div>
    </DragPreviewCard>
  );
}

export function setWebviewDragActive(active: boolean): void {
  if (active) {
    document.documentElement.dataset.explorerDragging = "true";
    window.getSelection()?.removeAllRanges();
  } else {
    delete document.documentElement.dataset.explorerDragging;
  }
}

export function dragAnnouncement(state: ExplorerDragViewState): string {
  if (state.error) return state.error;
  if (state.preparing) return "Preparing files for drag out.";
  if (state.phase === "dropping") return "Queueing dropped items.";
  return "";
}

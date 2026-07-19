import type { ExplorerDragViewState } from "./types";

export function ExplorerDragPreview({ state }: { state: ExplorerDragViewState }) {
  if (!state.payload || !state.pointer || state.phase === "native-egress") return null;
  const itemCount = `${state.payload.items.length} item${state.payload.items.length === 1 ? "" : "s"}`;
  const label = state.preparing ? `${itemCount} · Preparing…` : itemCount;
  return (
    <div
      className="pointer-events-none fixed z-[2147483500] max-w-64 rounded-lg border border-white/15 bg-[linear-gradient(135deg,rgba(56,60,68,.97),rgba(26,28,33,.97))] px-3 py-2 text-xs font-semibold text-white shadow-2xl"
      style={{ left: state.pointer.x + 14, top: state.pointer.y + 16 }}
      role="status"
      aria-live="polite"
    >
      <div className="truncate">{state.payload.items[0]?.name}</div>
      <div className="mt-0.5 text-[10px] font-medium opacity-65">{label}</div>
    </div>
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

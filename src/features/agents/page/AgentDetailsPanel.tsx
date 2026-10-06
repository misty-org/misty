import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "@/shared/ui";
import "./agentDetailsPanel.css";

export type AgentDetailsSectionId = "task" | "sources" | "files";
export type AgentDetailsSection = {
  id: AgentDetailsSectionId;
  label: string;
  /** A short summary after the label: a count, a spinner, or "!" when something needs a look. */
  badge?: ReactNode;
  content: ReactNode;
};

export const minDetailsWidth = 260;
const maxDetailsWidth = 560;
/** The panel keeps this much of the window's edge clear on either side. */
const edgeInset = 16;

/**
 * Details about the open conversation: a card floating just under the title bar's Details
 * toggle, over the conversation rather than beside it. It stays mounted so it can grow
 * out of the toggle's corner and shrink back into it. Section chips (the shared pattern
 * Activity uses) switch sections one at a time, so none is ever below the fold, and each
 * chip summarizes its section. The leading edge resizes it; Escape closes it.
 */
export function AgentDetailsPanel({
  open,
  sections,
  section,
  width,
  onSection,
  onClose,
  onWidthChange,
}: {
  open: boolean;
  sections: AgentDetailsSection[];
  section: AgentDetailsSectionId;
  width: number;
  onSection(id: AgentDetailsSectionId): void;
  onClose(): void;
  onWidthChange(width: number): void;
}) {
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number }>(undefined);
  const [dragging, setDragging] = useState(false);
  const current = sections.find((s) => s.id === section) ?? sections[0];
  const clamp = (next: number) => {
    const body = root.current?.parentElement?.clientWidth ?? Infinity;
    const max = Math.min(maxDetailsWidth, body - 2 * edgeInset);
    return Math.round(Math.max(minDetailsWidth, Math.min(max, next)));
  };
  // The panel renders narrower than the chosen width when the window is narrow; resizing
  // starts from what is on screen, so the edge follows the pointer at once.
  const shownWidth = () => root.current?.offsetWidth ?? width;
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: shownWidth() };
    setDragging(true);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidthChange(clamp(drag.current.width + drag.current.x - event.clientX));
  };
  const endDrag = () => {
    drag.current = undefined;
    setDragging(false);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") onWidthChange(clamp(shownWidth() + step));
    else if (event.key === "ArrowRight") onWidthChange(clamp(shownWidth() - step));
    else return;
    event.preventDefault();
  };
  return (
    <aside
      ref={root}
      className="agent-details"
      aria-label="Details"
      aria-hidden={!open}
      inert={!open}
      data-open={open || undefined}
      data-dragging={dragging || undefined}
      // The chosen width, but never wider than the window less its edge insets.
      style={{ width: `min(${width}px, calc(100cqw - ${2 * edgeInset}px))` }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
        // Hand focus back to the toggle that opened the panel.
        root.current?.parentElement
          ?.querySelector<HTMLElement>("[data-agent-details-toggle]")
          ?.focus();
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        aria-valuenow={width}
        aria-valuemin={minDetailsWidth}
        aria-valuemax={maxDetailsWidth}
        tabIndex={0}
        className="agent-details-resizer"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={resizeByKey}
      />
      <header className="agent-details-header">
        <div role="group" aria-label="Details sections" className="agent-details-chips">
          {sections.map(({ id, label, badge }) => (
            <Button
              key={id}
              variant="chip"
              size="sm"
              className="shrink-0 font-normal"
              aria-pressed={id === current.id}
              onClick={() => onSection(id)}
            >
              <span>{label}</span>
              {badge !== undefined && badge !== null && (
                <span className="agent-details-badge">{badge}</span>
              )}
            </Button>
          ))}
        </div>
        <IconButton label="Close details" size="sm" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </header>
      <section aria-label={current.label} className="agent-details-body misty-transient-scrollbar">
        {current.content}
      </section>
    </aside>
  );
}

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const storageKey = "misty:agent-sidebar-width";
const minSidebarWidth = 200;
const maxSidebarWidth = 420;
const defaultSidebarWidth = 240;

const clamp = (width: number) =>
  Math.round(Math.max(minSidebarWidth, Math.min(maxSidebarWidth, width)));

// The width is a per-device layout convenience, like a project's open or closed state.
const readWidth = () => {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return saved ? clamp(saved) : defaultSidebarWidth;
  } catch {
    return defaultSidebarWidth;
  }
};
const writeWidth = (width: number) => {
  try {
    if (width === defaultSidebarWidth) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, String(width));
  } catch {
    // Storage is optional; the width still holds for this session.
  }
};

/** The agent sidebar's chosen width, remembered on this device. */
export function useAgentSidebarWidth() {
  const [width, setWidth] = useState(readWidth);
  const change = (next: number) => {
    const value = clamp(next);
    setWidth(value);
    writeWidth(value);
  };
  return [width, change] as const;
}

/**
 * The sidebar's trailing edge. Drag to resize, arrow keys step it, and a double-click
 * restores the default width.
 */
export function AgentSidebarResizer({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange(width: number): void;
}) {
  const drag = useRef<{ x: number; width: number }>(undefined);
  const [dragging, setDragging] = useState(false);
  // The sidebar can render narrower than the chosen width in a narrow window; resizing
  // starts from what is on screen, so the edge follows the pointer at once.
  const shownWidth = (element: HTMLElement) => element.parentElement?.offsetWidth ?? width;
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: shownWidth(event.currentTarget) };
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidthChange(drag.current.width + event.clientX - drag.current.x);
  };
  const end = () => {
    drag.current = undefined;
    setDragging(false);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const shown = shownWidth(event.currentTarget);
    if (event.key === "ArrowLeft") onWidthChange(shown - step);
    else if (event.key === "ArrowRight") onWidthChange(shown + step);
    else if (event.key === "Home") onWidthChange(minSidebarWidth);
    else if (event.key === "End") onWidthChange(maxSidebarWidth);
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={minSidebarWidth}
      aria-valuemax={maxSidebarWidth}
      tabIndex={0}
      className="agent-studio-resizer"
      data-dragging={dragging || undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onWidthChange(defaultSidebarWidth)}
      onKeyDown={key}
    />
  );
}

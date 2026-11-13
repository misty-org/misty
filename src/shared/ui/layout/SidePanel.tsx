// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import { Maximize2, Minimize2, X, type LucideIcon } from "lucide-react";
import {
  useContext,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../classNames";
import { IconButton } from "../controls/IconButton";
import { HeaderSlot, InPanel } from "./sidePanelContext";
import "./sidePanel.css";

/** Width steps the keyboard takes on the resize edge. */
const KEY_STEP = 16;

/**
 * The card a page docks beside its main column, such as a chat's files, changes, terminal or
 * browser. It floats on the window's surface a step off the column and the edge, rounded, with a
 * faint edge and a soft shadow and no line between it and the page. It takes width from the
 * column before it (its previous sibling), never below `keep` for that column; the person drags
 * the gap on its leading side to resize it. The header's expand button makes it cover that
 * column entirely, until it is restored.
 *
 * The header row belongs to what is open: a view renders its controls in `SidePanelHeader` and
 * they take the row's start (a branch picker, an address, terminal tabs). With nothing there the
 * row shows `name`. Expand and close always sit at its end.
 *
 * ```tsx
 * <SidePanel label="Changes" name="Changes" icon={GitCompareArrows} width={w} onResize={setW}
 *   onClose={close}>
 *   <SidePanelHeader><BranchPicker /></SidePanelHeader>
 *   <ChangesList />
 * </SidePanel>
 * ```
 */
export function SidePanel(props: {
  /** Its accessible name. */
  label: string;
  /** What shows at the header's start when the open view puts nothing there. */
  name?: string;
  icon?: LucideIcon;
  /** Its width in px; it never covers more than leaves `keep` of the column before it. */
  width: number;
  /** The narrowest it goes, 320 by default. */
  minWidth?: number;
  /** How much of the column before it always stays, 360 by default. */
  keep?: number;
  /** Dragging or arrowing its leading edge. Without it the panel keeps its width. */
  onResize?(width: number): void;
  /** Covers the column before it: the panel takes the whole width, the column stays mounted. */
  expanded?: boolean;
  onToggleExpanded?(): void;
  onClose(): void;
  children: ReactNode;
  /** Layout only. */
  className?: string;
  [key: `data-${string}`]: string | undefined;
}) {
  const {
    label,
    name,
    icon: Icon,
    width,
    minWidth = 320,
    keep = 360,
    onResize,
    expanded = false,
    onToggleExpanded,
    onClose,
    children,
    className,
    ...data
  } = props;
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const room = (panel: HTMLElement) => {
    const before = panel.previousElementSibling as HTMLElement | null;
    const spare = before ? before.getBoundingClientRect().width - keep : 0;
    return panel.getBoundingClientRect().width + Math.max(0, spare);
  };
  const clamp = (value: number, panel: HTMLElement) =>
    Math.min(Math.max(value, minWidth), Math.max(minWidth, room(panel)));
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!onResize || event.button !== 0) return;
    const handle = event.currentTarget;
    const panel = handle.parentElement;
    if (!panel) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const most = Math.max(minWidth, room(panel));
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = "";
    const move = (next: globalThis.PointerEvent) =>
      onResize(Math.min(Math.max(startWidth + (startX - next.clientX), minWidth), most));
    const end = () => {
      delete handle.dataset.dragging;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onResize || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP;
    onResize(clamp(panel.getBoundingClientRect().width + step, panel));
  };
  return (
    <aside
      {...data}
      aria-label={label}
      data-slot="side-panel"
      data-expanded={expanded || undefined}
      className={cn("misty-side-panel", className)}
      style={
        { "--side-panel-width": `${width}px`, "--side-panel-keep": `${keep}px` } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // A menu portaled out of the panel bubbles here too; its Escape only closes the menu.
        if (!event.currentTarget.contains(event.target as Node)) return;
        if ((event.target as HTMLElement).closest("input, textarea, [contenteditable], .xterm"))
          return;
        onClose();
      }}
    >
      {onResize ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label.toLowerCase()}`}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          tabIndex={0}
          className="misty-side-panel-resize"
          onPointerDown={drag}
          onKeyDown={nudge}
        />
      ) : null}
      <div className="misty-side-panel-head">
        {name ? (
          <span className="misty-side-panel-name">
            {Icon ? <Icon aria-hidden="true" /> : null}
            <span>{name}</span>
          </span>
        ) : null}
        <div ref={setSlot} className="misty-side-panel-slot" />
        <div className="misty-side-panel-end">
          {onToggleExpanded ? (
            <IconButton
              label={expanded ? "Restore width" : "Widen"}
              tooltipSide="bottom"
              aria-pressed={expanded}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
          ) : null}
          <IconButton label="Close" tooltipSide="bottom" onClick={onClose}>
            <X />
          </IconButton>
        </div>
      </div>
      <div className="misty-side-panel-body">
        <InPanel.Provider value>
          <HeaderSlot.Provider value={slot}>{children}</HeaderSlot.Provider>
        </InPanel.Provider>
      </div>
    </aside>
  );
}

/**
 * The open view's own controls, drawn in its SidePanel's header row instead of a first row of its
 * own. Outside a SidePanel it renders in place.
 */
export function SidePanelHeader({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlot);
  const inPanel = useContext(InPanel);
  if (!inPanel) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}

/**
 * The control a side panel's header opens with, such as the files tab's folder picker or the
 * changes tab's branch picker. The header starts it where the rows below start their wash, and its
 * text sits where their icons and names start, so the picked name lines up with the list under it.
 */
export function SidePanelLead({ children }: { children: ReactNode }) {
  return (
    <div data-side-panel-lead="" className="flex min-w-0 flex-[0_1_auto]">
      {children}
    </div>
  );
}

/**
 * A narrow glance card docked beside a page's column: as wide as a phone's sidebar, only as tall
 * as what it holds, and scrolling past the window. On a narrow page it floats over the column at
 * the edge instead of taking width from it.
 */
export function SideCard(props: {
  label: string;
  /** A control at its top corner, such as what it shows. */
  corner?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-label={props.label}
      data-slot="side-card"
      className={cn("misty-side-card", props.className)}
    >
      {props.corner ? <div className="misty-side-card-corner">{props.corner}</div> : null}
      <div className="misty-side-card-body">{props.children}</div>
    </aside>
  );
}

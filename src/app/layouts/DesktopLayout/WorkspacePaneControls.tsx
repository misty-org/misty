import { liftPanePresentation } from "@/features/workspace/paneDragPresentation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Move, X } from "lucide-react";
import { dockLeaves, useWorkspaceStore, type WorkspacePane } from "@/features/workspace";
import {
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "@/features/webviews/browserRuntime";
import { usePointerDrag } from "@/shared/hooks/usePointerReorder";
import { cn, IconButton, Portal } from "@/shared/ui";

/** How long the pointer must rest before the pane controls fade out. */
const CONTROLS_IDLE_MS = 1500;

export function WorkspacePaneControls({
  pane,
  onClose,
}: {
  pane: WorkspacePane;
  onClose: () => void;
}) {
  const root = useWorkspaceStore((state) => state.layout.root);
  const panes = dockLeaves(root);
  const drag = usePointerDrag(
    {
      id: pane.id,
      paneId: pane.id,
      label: pane.views.find((tab) => tab.id === pane.activeViewId)?.title ?? "Pane",
      scope: "workspace-panes",
    },
    () => liftPanePresentation(root, pane.id),
  );
  const anchor = useRef<HTMLSpanElement>(null);
  const [bounds, setBounds] = useState({ top: 0, right: 0 });
  const [hovered, setHovered] = useState(false);
  // The pointer is on the tray itself: only then is the app raised above the pages. Anywhere
  // else over a page it must stay beneath, or the page could not be clicked.
  const [onTray, setOnTray] = useState(false);
  const trayBounds = useRef(bounds);
  trayBounds.current = bounds;
  const multiple = panes.length >= 2;
  useLayoutEffect(() => {
    const paneElement = anchor.current?.closest<HTMLElement>("[data-workspace-pane]");
    if (!paneElement || !multiple) return;
    const update = () => {
      const rect = paneElement.getBoundingClientRect();
      // The tray straddles the pane's top edge, except under another pane: that pane's
      // native page would draw over it, so the tray stays inside this pane instead.
      const top = paneDirectlyAbove(paneElement, rect) ? rect.top + 4 : Math.max(4, rect.top - 14);
      const right = Math.max(4, window.innerWidth - rect.right + 4);
      // Runs for every scroll anywhere in the window; skip the render when nothing moved.
      setBounds((previous) =>
        previous.top === top && previous.right === right ? previous : { top, right },
      );
    };
    // Shows while the pointer moves over the pane (or its tray strip), then fades once
    // the pointer has been still for a moment.
    let idle: number | undefined;
    const track = (x: number, y: number) => {
      const rect = paneElement.getBoundingClientRect();
      const inside =
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.left &&
        x <= rect.right + 4 &&
        y >= rect.top - 20 &&
        y <= rect.bottom;
      window.clearTimeout(idle);
      setHovered(inside);
      const tray = trayBounds.current;
      const right = window.innerWidth - tray.right;
      setOnTray(
        inside && x >= right - 96 && x <= right + 8 && y >= tray.top - 8 && y <= tray.top + 36,
      );
      if (inside) idle = window.setTimeout(() => setHovered(false), CONTROLS_IDLE_MS);
    };
    const move = (event: PointerEvent) => track(event.clientX, event.clientY);
    // A native page swallows the pointer, so the host reports where it is while it is over one.
    const nativeMove = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (Number.isFinite(x) && Number.isFinite(y)) track(x, y);
    };
    const leave = () => {
      window.clearTimeout(idle);
      setHovered(false);
      setOnTray(false);
    };
    update();
    const observer = new ResizeObserver(update);
    for (let element: HTMLElement | null = paneElement; element; element = element.parentElement)
      observer.observe(element);
    window.addEventListener("pointermove", move);
    window.addEventListener("misty:browser-pointer", nativeMove);
    setBrowserPointerTrackingEnabled(true);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", update);
    // Scrolling inside the pane cannot move it; only an enclosing scroller can.
    const scrolled = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(paneElement)) update();
    };
    window.addEventListener("scroll", scrolled, true);
    return () => {
      window.clearTimeout(idle);
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("misty:browser-pointer", nativeMove);
      setBrowserPointerTrackingEnabled(false);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [root, multiple]);
  // While the pointer is on the tray, the app's layer is raised above the native pages, so the
  // tray is never hidden behind one.
  useEffect(() => {
    if (!hovered || !onTray) return;
    setBrowserWebviewsSuspended(true, "pane-controls");
    return () => setBrowserWebviewsSuspended(false, "pane-controls");
  }, [hovered, onTray]);
  if (!multiple) return null;
  return (
    <>
      <span ref={anchor} className="pointer-events-none absolute right-0 top-0" aria-hidden />
      <Portal>
        <div
          style={bounds}
          data-visible={hovered}
          className={cn(
            "pointer-events-none fixed layer-blocking-popup flex items-center gap-0.5",
            "rounded-md border border-charcoal-border bg-charcoal-card p-0.5",
            "opacity-0 transition-opacity data-[visible=true]:pointer-events-auto",
            "data-[visible=true]:opacity-100 hover:pointer-events-auto",
            "hover:opacity-100 has-[:focus-visible]:pointer-events-auto",
            "has-[:focus-visible]:opacity-100",
            "[@media(hover:none)]:pointer-events-auto",
            "[@media(hover:none)]:opacity-100",
          )}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconButton
            size="xs"
            tooltip={false}
            className="cursor-grab touch-none active:cursor-grabbing"
            data-reorder-handle
            label="Drag pane"
            title="Drag pane to an edge to move, or center to swap"
            onPointerDown={drag}
          >
            <Move className="size-3.5" size={14} />
          </IconButton>
          <IconButton
            size="xs"
            tooltip={false}
            label="Close pane"
            title="Close pane"
            onClick={onClose}
          >
            <X className="size-3" size={12} />
          </IconButton>
        </div>
      </Portal>
    </>
  );
}

/** Another pane ends just above this one's top-right corner, where the tray sits. */
function paneDirectlyAbove(pane: HTMLElement, rect: DOMRect): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-workspace-pane]")).some(
    (other) => {
      if (other === pane) return false;
      const above = other.getBoundingClientRect();
      return (
        above.bottom <= rect.top + 1 &&
        rect.top - above.bottom < 24 &&
        above.left < rect.right - 4 &&
        above.right > rect.right - 112
      );
    },
  );
}

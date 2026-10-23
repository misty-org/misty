import { createDragPreview } from "./pointerDragPreview";
import { startReorderMotion, settleReorderMotion } from "./pointerReorderMotion";
import {
  contains,
  dropTargets,
  visibleRect,
  type DropTarget,
  type ReorderDrag,
  type ReorderHit,
} from "./pointerDropTargets";
import type { PointerEvent as ReactPointerEvent } from "react";

let cancelCurrent: (() => void) | undefined;

export function startGesture(
  event: ReactPointerEvent<HTMLElement>,
  drag: ReorderDrag,
  onLift?: () => () => void,
) {
  let restorePresentation: (() => void) | undefined;
  let motion: ReturnType<typeof startReorderMotion>;
  cancelCurrent?.();
  settleReorderMotion();
  const source = (event.target as Element).closest<HTMLElement>("[data-reorder-handle]")!;
  const surface =
    source.closest<HTMLElement>("[data-reorder-preview]") ??
    source.querySelector<HTMLElement>("[data-reorder-preview]") ??
    source;
  const surfaceRect = surface.getBoundingClientRect();
  // A pane's label rides just below the pointer; a pane is far larger than its label, so the
  // press point on the pane says nothing about where the label belongs.
  const offset =
    drag.scope === "workspace-panes"
      ? { x: -12, y: -12 }
      : { x: event.clientX - surfaceRect.left, y: event.clientY - surfaceRect.top };
  const pointerId = event.pointerId;
  const origin = { x: event.clientX, y: event.clientY };
  let point = origin,
    active = false,
    ended = false,
    frame = 0;
  let current: { target: DropTarget; hit: ReorderHit } | undefined;
  let shield: HTMLDivElement | undefined,
    preview: HTMLDivElement | undefined,
    indicator: HTMLDivElement | undefined;
  const announce = (message: string) => {
    const live = document.createElement("div");
    live.className = "sr-only";
    live.setAttribute("role", "status");
    document.body.append(live);
    setTimeout(() => {
      live.textContent = message;
    }, 0);
    setTimeout(() => live.remove(), 1800);
  };
  const stop = (commit = false) => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key, true);
    document.removeEventListener("visibilitychange", visibility);
    source.removeEventListener("lostpointercapture", cancel);
    source.removeEventListener("dragstart", preventNative);
    try {
      if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture(pointerId);
    } catch {
      /* Native focus may already have released it. */
    }
    restorePresentation?.();
    restorePresentation = undefined;
    shield?.remove();
    if (!motion) preview?.remove();
    indicator?.remove();
    delete surface.dataset.reorderDragging;
    if (active) {
      delete document.documentElement.dataset.pointerDragging;
      window.dispatchEvent(new CustomEvent("misty:pointer-reorder", { detail: false }));
      // A completed drag must not activate a link, close a tab, or toggle a disclosure.
      const releaseClickGuard = () => {
        window.removeEventListener("click", suppressClick, true);
        window.removeEventListener("pointerdown", releaseClickGuard, true);
      };
      const suppressClick = (click: MouseEvent) => {
        if (click.detail === 0) return; // Keyboard activation remains available.
        click.preventDefault();
        click.stopImmediatePropagation();
        releaseClickGuard();
      };
      window.addEventListener("click", suppressClick, true);
      window.addEventListener("pointerdown", releaseClickGuard, true);
      setTimeout(releaseClickGuard, 500);
      announce(commit && current ? `${drag.label} moved.` : "Reordering cancelled.");
    }
    cancelCurrent = undefined;
    motion?.finish(preview);
    if (commit && active && current && dropTargets.has(current.target))
      current.target.drop(drag, current.hit);
  };
  const cancel = () => stop();
  const preventNative = (e: Event) => {
    e.preventDefault();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    }
  };
  const visibility = () => {
    if (document.hidden) cancel();
  };
  const update = () => {
    if (!source.isConnected) return cancel();
    current = undefined;
    const placement = motion?.placement(point, offset);
    const hitPoint = (target: DropTarget) =>
      target.element === motion?.list && placement
        ? { x: placement.hitX, y: placement.hitY }
        : point;
    // The smallest matching region wins, so tab headers beat pane docking zones.
    const candidates = [...dropTargets]
      .filter(
        (t) =>
          t.scope === drag.scope &&
          t.element.isConnected &&
          contains(visibleRect(t.element), hitPoint(t).x, hitPoint(t).y),
      )
      .sort((a, b) => {
        const ar = a.element.getBoundingClientRect(),
          br = b.element.getBoundingClientRect();
        return ar.width * ar.height - br.width * br.height;
      });
    for (const target of candidates) {
      const at = hitPoint(target);
      const hit = target.hit(at.x, at.y, drag);
      if (hit) {
        current = { target, hit };
        break;
      }
    }
    motion?.update(
      current?.target.element === motion.list ? current.hit.id : undefined,
      current?.hit.after,
    );
    if (preview) {
      preview.style.left = `${Math.max(0, Math.min(placement?.left ?? point.x - offset.x, window.innerWidth - preview.offsetWidth))}px`;
      preview.style.top = `${Math.max(0, Math.min(placement?.top ?? point.y - offset.y, window.innerHeight - preview.offsetHeight))}px`;
    }
    if (indicator) {
      indicator.hidden = !current || current.target.element === motion?.list;
      if (current) {
        const { rect, after, axis } = current.hit;
        const r = current.hit.previewRect ?? rect;
        Object.assign(
          indicator.style,
          drag.scope === "workspace-panes" || current.hit.box
            ? {
                left: `${r.left}px`,
                top: `${r.top}px`,
                width: `${r.width}px`,
                height: `${r.height}px`,
                opacity: "0.2",
                border: "1px solid currentColor",
                // Matches the panes' own corners.
                borderRadius: drag.scope === "workspace-panes" ? "12px" : "",
              }
            : axis === "x"
              ? {
                  left: `${after ? r.right : r.left}px`,
                  top: `${r.top}px`,
                  width: "2px",
                  height: `${r.height}px`,
                }
              : {
                  left: `${r.left}px`,
                  top: `${after ? r.bottom : r.top}px`,
                  width: `${r.width}px`,
                  height: "2px",
                },
        );
      }
    }
    let scroll = current?.target.element;
    while (scroll && scroll !== document.body) {
      const style = getComputedStyle(scroll),
        r = scroll.getBoundingClientRect();
      const speed = (position: number, start: number, end: number) =>
        position < start + 28
          ? -Math.ceil((start + 28 - position) / 4)
          : position > end - 28
            ? Math.ceil((position - end + 28) / 4)
            : 0;
      let moved = false;
      if (/(auto|scroll)/.test(style.overflowY) && scroll.scrollHeight > scroll.clientHeight) {
        const before = scroll.scrollTop;
        scroll.scrollTop += speed(point.y, r.top, r.bottom);
        moved = before !== scroll.scrollTop;
      }
      if (/(auto|scroll)/.test(style.overflowX) && scroll.scrollWidth > scroll.clientWidth) {
        const before = scroll.scrollLeft;
        scroll.scrollLeft += speed(point.x, r.left, r.right);
        moved ||= before !== scroll.scrollLeft;
      }
      if (moved) break;
      scroll = scroll.parentElement ?? undefined;
    }
  };
  const tick = () => {
    if (ended || !active) return;
    update();
    if (!ended) frame = requestAnimationFrame(tick);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (e.buttons === 0) return cancel();
    point = { x: e.clientX, y: e.clientY };
    if (!active && Math.hypot(point.x - origin.x, point.y - origin.y) >= 6) {
      active = true;
      window.getSelection()?.removeAllRanges();
      document.documentElement.dataset.pointerDragging = "true";
      if (drag.scope === "workspace-panes") {
        preview = document.createElement("div");
        preview.className = "pointer-reorder-preview pointer-pane-title";
        preview.textContent = drag.label;
        preview.setAttribute("aria-hidden", "true");
      } else {
        preview = createDragPreview(surface).preview;
      }
      const list = surface.closest<HTMLElement>('[data-reorder-animated="true"]');
      if (list) {
        motion = startReorderMotion(
          surface,
          drag.ids ?? [drag.id],
          list.dataset.reorderAxis === "y" ? "y" : "x",
        );
        preview.classList.add("pointer-reorder-tab-preview");
        // Inactive tabs belong to a transparent strip at rest, but the lifted
        // tab must be opaque so its neighbors visibly pass underneath it.
        const lifted = preview.firstElementChild as HTMLElement | null;
        if (lifted) lifted.style.backgroundColor = "var(--color-charcoal-bg)";
      }
      restorePresentation = onLift?.();
      surface.dataset.reorderDragging = "true";
      window.dispatchEvent(new CustomEvent("misty:pointer-reorder", { detail: true }));
      shield = document.createElement("div");
      shield.className = "pointer-reorder-shield";
      shield.setAttribute("aria-hidden", "true");
      document.body.append(shield);
      document.body.append(preview);
      indicator = document.createElement("div");
      indicator.className = "pointer-reorder-indicator";
      document.body.append(indicator);
      announce(`Moving ${drag.label}. Escape cancels.`);
      tick();
    }
    if (active) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (active) {
      point = { x: e.clientX, y: e.clientY };
      update();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    stop(true);
  };
  window.addEventListener("pointermove", move, { capture: true, passive: false });
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", key, true);
  document.addEventListener("visibilitychange", visibility);
  source.addEventListener("lostpointercapture", cancel);
  source.addEventListener("dragstart", preventNative);
  try {
    source.setPointerCapture?.(pointerId);
  } catch {
    /* Window listeners still track the gesture. */
  }
  cancelCurrent = cancel;
  return cancel;
}

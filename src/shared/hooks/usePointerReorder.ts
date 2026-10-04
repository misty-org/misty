import "./pointerReorder.css";
import { createDragPreview } from "./pointerDragPreview";
import { reorderLayoutRect, startReorderMotion, settleReorderMotion } from "./pointerReorderMotion";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

export { createDragPreview } from "./pointerDragPreview";

export type ReorderDrag = {
  id: string;
  label: string;
  scope: string;
  paneId?: string;
  ids?: string[];
};
type Hit = { id: string; after: boolean; rect: DOMRect; previewRect?: DOMRect; axis: "x" | "y" };
type Target = {
  element: HTMLElement;
  scope: string;
  hit(x: number, y: number, drag: ReorderDrag): Hit | null;
  drop(drag: ReorderDrag, hit: Hit): void;
};
const targets = new Set<Target>();
let cancelCurrent: (() => void) | undefined;
const contains = (r: DOMRect, x: number, y: number) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

function visibleRect(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  let left = bounds.left,
    right = bounds.right,
    top = bounds.top,
    bottom = bounds.bottom;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent),
      rect = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
  }
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** Pointer-only gestures never enter Tauri's native file/HTML drag loop. */
export function usePointerDropTarget(
  ref: RefObject<HTMLElement | null>,
  options: Omit<Target, "element">,
) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target: Target = {
      element,
      scope: options.scope,
      hit: (...args) => latest.current.hit(...args),
      drop: (...args) => latest.current.drop(...args),
    };
    targets.add(target);
    return () => {
      targets.delete(target);
    };
  }, [ref, options.scope]);
}

function startGesture(
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
  const offset = { x: event.clientX - surfaceRect.left, y: event.clientY - surfaceRect.top };
  const pointerId = event.pointerId;
  const origin = { x: event.clientX, y: event.clientY };
  let point = origin,
    active = false,
    ended = false,
    frame = 0;
  let current: { target: Target; hit: Hit } | undefined;
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
    if (commit && active && current && targets.has(current.target))
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
    const hitPoint = (target: Target) =>
      target.element === motion?.list && placement
        ? { x: placement.hitX, y: placement.hitY }
        : point;
    // The smallest matching region wins, so tab headers beat pane docking zones.
    const candidates = [...targets]
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
          drag.scope === "workspace-panes"
            ? {
                left: `${r.left}px`,
                top: `${r.top}px`,
                width: `${r.width}px`,
                height: `${r.height}px`,
                opacity: "0.2",
                border: "1px solid currentColor",
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
        // Horizontal workspace tabs lift with their own curved tab shape.
        const lifted = preview.firstElementChild as HTMLElement | null;
        const tabShape = lifted?.querySelector<SVGElement>(".misty-workspace-tab-shape");
        if (tabShape && list.dataset.reorderAxis !== "y") {
          // Computed styles were frozen per node, so each descendant inherited "hidden".
          for (const node of [tabShape, ...tabShape.querySelectorAll<SVGElement>("*")])
            node.style.visibility = "visible";
          lifted!.style.overflow = "visible";
          preview.classList.add("pointer-reorder-shaped-preview");
        } else if (lifted) {
          lifted.style.backgroundColor = "var(--color-charcoal-bg)";
        }
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

export function usePointerDrag(drag: ReorderDrag, onLift?: () => () => void) {
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancel.current?.(), []);
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    cancel.current = startGesture(event, drag, onLift);
  };
}

export function usePointerReorder(options: {
  scope: string;
  axis: "x" | "y";
  hitArea?: "item" | "header";
  animate?: boolean;
  getDrag(id: string, element: HTMLElement): Omit<ReorderDrag, "scope"> | null;
  onDrop(drag: ReorderDrag, targetId: string, after: boolean): void;
  onKeyboardMove(id: string, direction: -1 | 1): void;
}) {
  // Disclosure content mounts independently of the component owning this hook.
  // Track the actual node so closing/reopening a category replaces its drop target.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const ref = useMemo(() => ({ current: element }), [element]);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const items = () =>
    [...(ref.current?.querySelectorAll<HTMLElement>("[data-reorder-item]") ?? [])].filter(
      (item) => item.closest("[data-reorder-list]") === ref.current,
    );
  usePointerDropTarget(ref, {
    scope: options.scope,
    hit(x, y) {
      const available = items().filter((item) => item.getBoundingClientRect().height > 0);
      if (!available.length) {
        const rect = ref.current?.getBoundingClientRect();
        return rect ? { id: "", after: true, rect, axis: options.axis } : null;
      }
      const position = options.axis === "x" ? x : y;
      const hitRect = (item: HTMLElement) => {
        const header =
          options.hitArea === "header"
            ? item.querySelector<HTMLElement>("[data-reorder-header], [data-reorder-handle]")
            : null;
        return header ? header.getBoundingClientRect() : reorderLayoutRect(item);
      };
      const item =
        available.find((item) => {
          const r = hitRect(item);
          return position <= (options.axis === "x" ? r.right : r.bottom);
        }) ?? available[available.length - 1];
      const rect = reorderLayoutRect(item);
      const hit = hitRect(item);
      return {
        id: item.dataset.reorderItem!,
        after:
          position >= (options.axis === "x" ? hit.left + hit.width / 2 : hit.top + hit.height / 2),
        rect,
        axis: options.axis,
      };
    },
    drop: (drag, hit) => options.onDrop(drag, hit.id, hit.after),
  });
  useEffect(() => () => cancel.current?.(), [options.scope]);
  return {
    ref: setElement,
    "data-reorder-list": options.scope,
    "data-reorder-animated": options.animate ? "true" : undefined,
    "data-reorder-axis": options.axis,
    onDragStartCapture: (event: React.DragEvent) => {
      if ((event.target as Element).closest("[data-reorder-handle]")) event.preventDefault();
    },
    onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        event.isPrimary === false ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = event.target as Element;
      const handle = target.closest<HTMLElement>("[data-reorder-handle]");
      const item = handle?.closest<HTMLElement>("[data-reorder-item]");
      if (
        !handle ||
        !item ||
        item.closest("[data-reorder-list]") !== ref.current ||
        target.closest("input, textarea, [contenteditable=true], [data-reorder-ignore]")
      )
        return;
      const drag = options.getDrag(item.dataset.reorderItem!, item);
      if (!drag) return;
      event.stopPropagation();
      cancel.current = startGesture(event, { ...drag, scope: options.scope });
    },
    onKeyDownCapture: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      const item = (event.target as Element).closest<HTMLElement>("[data-reorder-item]");
      if (!item || item.closest("[data-reorder-list]") !== ref.current) return;
      const direction =
        event.key === (options.axis === "x" ? "ArrowLeft" : "ArrowUp")
          ? -1
          : event.key === (options.axis === "x" ? "ArrowRight" : "ArrowDown")
            ? 1
            : 0;
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      options.onKeyboardMove(item.dataset.reorderItem!, direction);
    },
  };
}

export function reorderIds(ids: string[], moving: string[], target: string, after: boolean) {
  if (moving.includes(target) || !ids.includes(target)) return ids;
  const picked = ids.filter((id) => moving.includes(id));
  if (!picked.length) return ids;
  const rest = ids.filter((id) => !moving.includes(id));
  const index = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, index), ...picked, ...rest.slice(index)];
}

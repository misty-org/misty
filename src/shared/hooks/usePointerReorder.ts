import "../ui/patterns/pointerReorder.css";
import { reorderLayoutRect } from "./pointerReorderMotion";
import { createDwell } from "./pointerDwell";
import { startGesture } from "./pointerGesture";
import { usePointerDropTarget, type ReorderDrag } from "./pointerDropTargets";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export { usePointerDropTarget } from "./pointerDropTargets";
export { createDwell } from "./pointerDwell";

/**
 * Starts a drag from a press on a row that isn't in a reorder list (a sidebar chat dragged onto
 * the panes). The row, or an ancestor, carries `data-reorder-handle`; a plain click still clicks.
 */
export function startPointerDrag(event: ReactPointerEvent<HTMLElement>, drag: ReorderDrag) {
  if (event.button !== 0 || !event.isPrimary || event.metaKey || event.ctrlKey || event.shiftKey)
    return;
  startGesture(event, drag);
}

/**
 * Starts a drag from a pointerdown, or from a pointermove with the primary button held,
 * so a control can first decide what a gesture is (a pull versus a reorder) and hand off.
 */
export function usePointerDrag(drag: ReorderDrag, onLift?: () => () => void) {
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancel.current?.(), []);
  return (event: ReactPointerEvent<HTMLElement>) => {
    const pressed = event.type === "pointerdown" ? event.button === 0 : (event.buttons & 1) === 1;
    if (!pressed || !event.isPrimary) return;
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
  /** A drag rested on another item for a moment (a tab paused over opens while held). */
  onDwell?(id: string): void;
}) {
  const dwell = useRef(createDwell());
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
    hit(x, y, drag) {
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
      if (options.onDwell) {
        const over = item.dataset.reorderItem!;
        dwell.current(over === drag.id ? null : over, (id) => options.onDwell?.(id));
      }
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
      // ⌥⇧ and an arrow selects by word in a text field.
      if ((event.target as Element).closest("input, textarea, [contenteditable=true]")) return;
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

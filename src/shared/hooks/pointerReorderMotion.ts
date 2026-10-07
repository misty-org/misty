/** Tab-only layout previews. Hit testing stays in layout coordinates while paint moves. */
const layouts = new WeakMap<
  HTMLElement,
  { rect: DOMRect; list: HTMLElement; x: number; y: number }
>();
let settleCurrent: (() => void) | undefined;
export function settleReorderMotion() {
  settleCurrent?.();
}

const timing = { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function reorderLayoutRect(element: HTMLElement): DOMRect {
  const saved = layouts.get(element);
  if (!saved) return element.getBoundingClientRect();
  return new DOMRect(
    saved.rect.x + saved.x - saved.list.scrollLeft,
    saved.rect.y + saved.y - saved.list.scrollTop,
    saved.rect.width,
    saved.rect.height,
  );
}

export function startReorderMotion(surface: HTMLElement, ids: string[], axis: "x" | "y") {
  const list = surface.closest<HTMLElement>('[data-reorder-animated="true"]');
  if (!list) return;
  const items = [...list.querySelectorAll<HTMLElement>("[data-reorder-item]")].filter(
    (item) => item.closest("[data-reorder-list]") === list,
  );
  const moving = items.filter((item) => ids.includes(item.dataset.reorderItem!));
  const animations = new Map<HTMLElement, Animation>();
  const original = new Map(items.map((item) => [item, item.style.transform]));
  let lastOrder = items;
  let finishFrame = 0;
  let settlingPreview: HTMLElement | undefined;
  let settlingAnimation: Animation | undefined;
  const restore = () => {
    for (const item of items) {
      animations.get(item)?.cancel();
      item.style.transform = original.get(item) ?? "";
      layouts.delete(item);
      delete item.dataset.reorderLifted;
    }
  };
  const cleanup = () => {
    cancelAnimationFrame(finishFrame);
    settlingAnimation?.cancel();
    settlingPreview?.remove();
    restore();
    if (settleCurrent === cleanup) settleCurrent = undefined;
  };
  settleCurrent = cleanup;
  for (const item of items) {
    layouts.set(item, {
      rect: item.getBoundingClientRect(),
      list,
      x: list.scrollLeft,
      y: list.scrollTop,
    });
  }
  for (const item of moving) item.dataset.reorderLifted = "true";
  const start = (rect: DOMRect) => (axis === "x" ? rect.left : rect.top);
  const size = (rect: DOMRect) => (axis === "x" ? rect.width : rect.height);
  const transform = (delta: number) =>
    axis === "x" ? `translateX(${delta}px)` : `translateY(${delta}px)`;
  const animate = (item: HTMLElement, from: string, to: string) => {
    animations.get(item)?.cancel();
    if (!reduceMotion() && item.animate && from !== to) {
      const animation = item.animate([{ transform: from }, { transform: to }], timing);
      animations.set(item, animation);
      animation.onfinish = () => {
        if (animations.get(item) === animation) animations.delete(item);
      };
    }
  };
  return {
    list,
    placement(point: { x: number; y: number }, offset: { x: number; y: number }) {
      const bounds = list.getBoundingClientRect();
      const source = reorderLayoutRect(surface);
      const horizontal = axis === "x";
      const along = horizontal ? point.x : point.y;
      const across = horizontal ? point.y : point.x;
      const min = horizontal ? bounds.left : bounds.top;
      const max = horizontal ? bounds.right : bounds.bottom;
      const crossMin = horizontal ? bounds.top : bounds.left;
      const crossMax = horizontal ? bounds.bottom : bounds.right;
      // Slight vertical drift should not lift a horizontal tab out of its row.
      // Leaving the strip deliberately still allows cross-pane drops/cancel.
      if (along < min - 12 || along > max + 12 || across < crossMin - 40 || across > crossMax + 40)
        return;
      const first = reorderLayoutRect(items[0]);
      const last = reorderLayoutRect(items[items.length - 1]);
      const edge = Math.max(
        start(first),
        Math.min(
          along - (horizontal ? offset.x : offset.y),
          start(last) + size(last) - size(source),
        ),
      );
      const left = horizontal ? edge : source.left;
      const top = horizontal ? source.top : edge;
      // Lead with the edge facing the direction of travel, so a neighbor swaps
      // once the lifted item covers half of it rather than all of it.
      const travel = edge - start(source);
      const hit =
        edge <= start(first)
          ? start(first)
          : edge >= start(last) + size(last) - size(source)
            ? start(last) + size(last)
            : travel > 0
              ? edge + size(source) - 0.5
              : travel < 0
                ? edge + 0.5
                : edge + size(source) / 2;
      return {
        left,
        top,
        hitX: horizontal ? hit : left + source.width / 2,
        hitY: horizontal ? top + source.height / 2 : hit,
      };
    },
    update(target?: string, after = false) {
      let order = items;
      if (target && !ids.includes(target)) {
        const rest = items.filter((item) => !moving.includes(item));
        const index = rest.findIndex((item) => item.dataset.reorderItem === target);
        if (index >= 0) {
          const insertion = index + (after ? 1 : 0);
          order = [...rest.slice(0, insertion), ...moving, ...rest.slice(insertion)];
        }
      }
      if (order.every((item, index) => item === lastOrder[index])) return;
      lastOrder = order;
      const gap =
        Number.parseFloat(getComputedStyle(list)[axis === "x" ? "columnGap" : "rowGap"]) || 0;
      const margins = (item: HTMLElement) => {
        const style = getComputedStyle(item);
        return [
          Number.parseFloat(style[axis === "x" ? "marginLeft" : "marginTop"]) || 0,
          Number.parseFloat(style[axis === "x" ? "marginRight" : "marginBottom"]) || 0,
        ];
      };
      let cursor = start(reorderLayoutRect(items[0])) - margins(items[0])[0];
      for (const item of order) {
        const [leading, trailing] = margins(item);
        cursor += leading;
        const rect = reorderLayoutRect(item);
        const delta = cursor - start(rect);
        if (!moving.includes(item)) {
          const painted = getComputedStyle(item).transform;
          const next = transform(delta);
          item.style.transform = next;
          animate(item, painted === "none" ? transform(0) : painted, next);
        }
        cursor += size(rect) + trailing + gap;
      }
    },
    finish(preview?: HTMLElement) {
      const painted = new Map(items.map((item) => [item, item.getBoundingClientRect()]));
      const previewRect = preview?.getBoundingClientRect();
      // The drop commits React's new order before the next paint. Reconcile from
      // the current animated positions, so interruption and release never snap.
      settlingPreview = preview;
      finishFrame = requestAnimationFrame(() => {
        restore();
        for (const item of items) {
          if (!item.isConnected) continue;
          const before = moving.includes(item) ? undefined : painted.get(item);
          if (!before) continue;
          const delta = start(before) - start(item.getBoundingClientRect());
          animate(item, transform(delta), original.get(item) || transform(0));
        }
        const destination = surface.isConnected ? surface.getBoundingClientRect() : undefined;
        if (preview && previewRect && destination && !reduceMotion() && preview.animate) {
          for (const item of moving) item.dataset.reorderLifted = "true";
          const animation = preview.animate(
            [
              { transform: "translate(0, 0)" },
              {
                transform: `translate(${destination.left - previewRect.left}px, ${destination.top - previewRect.top}px)`,
              },
            ],
            timing,
          );
          const done = () => {
            preview.remove();
            for (const item of moving) delete item.dataset.reorderLifted;
          };
          settlingAnimation = animation;
          animation.onfinish = done;
          animation.oncancel = done;
        } else preview?.remove();
      });
    },
  };
}

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export function StablePaneLayout({
  children,
  panes,
}: {
  children: ReactNode;
  panes: { id: string; content: ReactNode }[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const observed = useRef<{ elements: Element[]; observer: ResizeObserver } | null>(null);
  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      observed.current?.observer.disconnect();
      observed.current = null;
    },
    [],
  );
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const slots = Array.from(root.querySelectorAll<HTMLElement>("[data-pane-layout-slot]")).filter(
      (slot) => slot.closest("[data-stable-pane-layout]") === root,
    );
    const contents = new Map(
      Array.from(root.children)
        .filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && child.hasAttribute("data-pane-layout-content"),
        )
        .map((child) => [child.dataset.paneLayoutContent, child]),
    );
    const position = () => {
      const origin = root.getBoundingClientRect();
      const computed = getComputedStyle(root);
      const scaleX = origin.width / parseFloat(computed.width) || 1;
      const scaleY = origin.height / parseFloat(computed.height) || 1;
      const bounds = slots.map((slot) => ({
        id: slot.dataset.paneLayoutSlot,
        rect: slot.getBoundingClientRect(),
      }));
      let changed = false;
      for (const { id, rect } of bounds) {
        const content = contents.get(id);
        if (!content) continue;
        const next = {
          left: `${(rect.left - origin.left) / scaleX}px`,
          top: `${(rect.top - origin.top) / scaleY}px`,
          width: `${rect.width / scaleX}px`,
          height: `${rect.height / scaleY}px`,
        };
        if (
          Object.entries(next).some(
            ([key, value]) => content.style[key as keyof typeof next] !== value,
          )
        ) {
          Object.assign(content.style, next);
          changed = true;
        }
      }
      if (changed) window.dispatchEvent(new Event("misty:workspace-geometry-changed"));
    };
    const elements = [...slots, ...contents.values()];
    const previous = observed.current;
    if (
      previous &&
      previous.elements.length === elements.length &&
      previous.elements.every((element, index) => element === elements[index])
    )
      return;
    position();
    previous?.observer.disconnect();
    const observer = new ResizeObserver(position);
    observer.observe(root);
    slots.forEach((slot) => observer.observe(slot));
    observed.current = { elements, observer };
  });
  return (
    <div
      ref={rootRef}
      data-stable-pane-layout
      className="relative h-full min-h-0 w-full min-w-0"
      onPointerDownCapture={(event) => {
        if (
          event.button !== 0 ||
          !(event.target instanceof Element) ||
          !event.target.closest("[data-panel-resize-handle-id], [data-pane-layout-resizer]")
        )
          return;
        resizeCleanupRef.current?.();
        const contents = Array.from(event.currentTarget.children).filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && child.hasAttribute("data-pane-layout-content"),
        );
        contents.forEach((content) => {
          content.style.pointerEvents = "none";
        });
        const finish = () => {
          contents.forEach((content) => {
            content.style.removeProperty("pointer-events");
          });
          window.removeEventListener("pointerup", finish, true);
          window.removeEventListener("pointercancel", finish, true);
          window.removeEventListener("blur", finish);
          resizeCleanupRef.current = null;
        };
        resizeCleanupRef.current = finish;
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
        window.addEventListener("blur", finish);
      }}
    >
      {children}
      {[...panes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ id, content }) => (
          <div key={id} data-pane-layout-content={id} className="absolute min-h-0 min-w-0">
            {content}
          </div>
        ))}
    </div>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../utils";

const STEP = 9;

/**
 * Up to `max` avatars side by side, the active one on the right and in front. Choosing another
 * shuffles it to the front: every avatar keeps its element and slides to its new place, the new
 * front one pops in and the rest hop as they pass.
 */
export function AvatarShuffleStack(props: {
  items: { id: string; node: ReactNode }[];
  activeId?: string;
  max?: number;
}) {
  const { items, max = 5 } = props;
  const at = Math.max(0, items.findIndex((item) => item.id === props.activeId));
  // Left to right: the others in rotation, then the active one, on the right and in front.
  const order = [...items.slice(at), ...items.slice(0, at)]
    .slice(0, max)
    .map((item) => item.id)
    .reverse();
  const front = order.length - 1;
  const faces = useRef(new Map<string, HTMLSpanElement>());
  const shownId = useRef(props.activeId);

  useEffect(() => {
    if (shownId.current === props.activeId) return;
    const first = shownId.current === undefined;
    shownId.current = props.activeId;
    if (first || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    faces.current.forEach((face, id) => {
      const lead = id === props.activeId;
      face.animate(
        lead
          ? [
              { transform: "translateY(-5px) scale(0.6)" },
              { transform: "translateY(-2px) scale(1.18)", offset: 0.55 },
              { transform: "none" },
            ]
          : [
              { transform: "none" },
              { transform: "translateY(-3px) rotate(-8deg)", offset: 0.4 },
              { transform: "none" },
            ],
        { duration: lead ? 420 : 340, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" },
      );
    });
  }, [props.activeId]);

  return (
    <span
      className="relative block h-5 shrink-0"
      style={{ width: 20 + Math.max(order.length - 1, 0) * STEP }}
      aria-hidden="true"
    >
      {items.map((item) => {
        const index = order.indexOf(item.id);
        return (
          <span
            key={item.id}
            className={cn(
              "absolute left-0 top-0 flex rounded-full transition-[transform,opacity] duration-300",
              "ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none",
            )}
            style={{
              transform: `translateX(${Math.max(index, 0) * STEP}px)`,
              opacity: index < 0 ? 0 : index === front ? 1 : 0.5,
              zIndex: index + 1,
            }}
          >
            <span
              ref={(face) => {
                if (face) faces.current.set(item.id, face);
                else faces.current.delete(item.id);
              }}
              className="flex rounded-full [&>*]:size-5 [&>*]:rounded-full"
            >
              {item.node}
            </span>
          </span>
        );
      })}
    </span>
  );
}

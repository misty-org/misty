import type { ReactNode } from "react";
import { cn } from "../utils";

const STEP = 9;

/**
 * Up to `max` avatars side by side, the active one on the right and in front. Choosing another rotates
 * it to the front: every avatar keeps its element, so each slides to its new place.
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
              "[&>*]:size-5 [&>*]:rounded-full",
            )}
            style={{
              transform: `translateX(${Math.max(index, 0) * STEP}px) scale(1)`,
              opacity: index < 0 ? 0 : index === front ? 1 : 0.5,
              zIndex: index + 1,
            }}
          >
            {item.node}
          </span>
        );
      })}
    </span>
  );
}

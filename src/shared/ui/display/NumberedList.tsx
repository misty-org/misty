import { cn } from "../classNames";
import { Text } from "./Text";

export type NumberedListProps = {
  /** The points, in order. Each is one sentence or two. */
  items: readonly string[];
  /** Layout only. */
  className?: string;
};

/**
 * A few points to read in order, each after its muted number, in page text, such as what Misty,
 * an AI and a space are each for. The numbers are for the eye; the list itself is ordered.
 *
 * ```tsx
 * <NumberedList items={points} />
 * ```
 */
export function NumberedList({ items, className }: NumberedListProps) {
  return (
    <ol data-slot="numbered-list" className={cn("flex flex-col gap-4", className)}>
      {items.map((item, position) => (
        <li key={item} className="flex gap-4">
          <Text as="span" size="page" tone="muted" aria-hidden>
            {position + 1}
          </Text>
          <Text size="page" tone="bright" wrap>
            {item}
          </Text>
        </li>
      ))}
    </ol>
  );
}

import { MousePointer2 } from "lucide-react";
import { cn } from "../classNames";
import type { ItemTone } from "../icons/itemTones";
import { Text } from "./Text";

/** A tone as the pointer's fill and its name tag's, written out so Tailwind keeps the classes. */
const pointerTone: Record<ItemTone, { glyph: string; tag: string }> = {
  blue: { glyph: "text-tone-blue fill-tone-blue", tag: "bg-tone-blue" },
  red: { glyph: "text-tone-red fill-tone-red", tag: "bg-tone-red" },
  green: { glyph: "text-tone-green fill-tone-green", tag: "bg-tone-green" },
  orange: { glyph: "text-tone-orange fill-tone-orange", tag: "bg-tone-orange" },
  violet: { glyph: "text-tone-violet fill-tone-violet", tag: "bg-tone-violet" },
  pink: { glyph: "text-tone-pink fill-tone-pink", tag: "bg-tone-pink" },
  amber: { glyph: "text-tone-amber fill-tone-amber", tag: "bg-tone-amber" },
  teal: { glyph: "text-tone-teal fill-tone-teal", tag: "bg-tone-teal" },
  sand: { glyph: "text-tone-sand fill-tone-sand", tag: "bg-tone-sand" },
};

/**
 * Someone else's pointer over a page people work on together, with their name, in their tone (the
 * same one as their avatar). It's placed by its parent, at `left` and `top` in pixels, and glides
 * between where it's told to be.
 */
export function LivePointer({
  name,
  tone,
  left,
  top,
}: {
  name: string;
  tone: ItemTone;
  left: number;
  top: number;
}) {
  return (
    <span
      className="absolute flex items-start transition-[left,top] duration-75 ease-linear motion-reduce:transition-none"
      style={{ left, top }}
      aria-hidden="true"
    >
      <MousePointer2 className={pointerTone[tone].glyph} />
      <Text
        bare
        size="caption"
        weight="medium"
        className={cn("mt-3.5 -ml-1 rounded-sm px-1.5 text-ink-on-color", pointerTone[tone].tag)}
      >
        {name}
      </Text>
    </span>
  );
}

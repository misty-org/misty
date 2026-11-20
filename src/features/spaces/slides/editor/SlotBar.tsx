import { Bold, List } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton, Surface } from "@misty/ui";
import { SLIDE_HEIGHT, type SlotBox } from "../deck/layouts";

/** Screen pixels between the bar and the slot it sits over. */
const BAR_GAP = 8;

/**
 * The small bar above the slot being edited: Bold, Bullets and Ask agent. It sits in the slide's
 * frame over its slot and is drawn back at screen size, whatever the slide's scale.
 */
export function SlotBar(props: {
  box: SlotBox;
  scale: number;
  bold: boolean;
  /** Left out where the slot takes no bullets (a title). */
  bullets?: boolean;
  onBold(): void;
  onBullets(): void;
  askAgent?: ReactNode;
}) {
  const inverse = props.scale > 0 ? 1 / props.scale : 1;
  // Kept inside the slide when the slot starts at its top edge.
  const anchor = Math.max(props.box.y - BAR_GAP * inverse, 48 * inverse);
  return (
    <div
      style={{
        position: "absolute",
        left: `${props.box.x}px`,
        bottom: `${SLIDE_HEIGHT - anchor}px`,
        transform: `scale(${inverse})`,
        transformOrigin: "0 100%",
        zIndex: 2,
      }}
      // Pressing the bar keeps the caret in the slot.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Surface tone="card" edge="hairline" radius="lg" className="flex items-center gap-0.5 p-0.5">
        <IconButton label="Bold" shortcut="⌘B" aria-pressed={props.bold} onClick={props.onBold}>
          <Bold />
        </IconButton>
        {props.bullets !== undefined ? (
          <IconButton label="Bullets" aria-pressed={props.bullets} onClick={props.onBullets}>
            <List />
          </IconButton>
        ) : null}
        {props.askAgent}
      </Surface>
    </div>
  );
}

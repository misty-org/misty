import * as React from "react";
import { cn } from "../classNames";
import "./pressable.css";

/**
 * What a Pressable shows under the pointer and on keyboard focus (pressable.css). Its text
 * brightens to cream in each; the open item (`aria-current`) keeps its own fill instead.
 * - `row`: the light wash of sidebar rows and tabs.
 * - `control`: the wash of list and tree rows (ListRow, TreeRow) and quiet buttons.
 * - `text`: no fill, only the text brightens, for small rows of facts.
 * - `card`: a bordered card lifts, as collection cards do.
 * - `strong`: the pressed fill and bright text, for a control that must answer clearly.
 * - `tint`: a tinted surface (Surface's `tint`) takes more of its color.
 * - `panel`: a solid panel that is the button itself, edge to edge (a scene panel's Team button):
 *   the control wash laid over its own fill, so what is behind never shows through.
 * A `data-hover` attribute shows the wash without the pointer, for a hover the page can't see.
 */
export type PressableWash = "row" | "control" | "text" | "card" | "strong" | "tint" | "panel";

export type PressableProps = React.ComponentPropsWithoutRef<"button"> & {
  /** The shared hover look. Without it the content draws its own. */
  wash?: PressableWash;
  /**
   * The item shown now in a list of them (the step whose picture is on screen): it keeps its
   * wash's pressed fill, hovered or not. For `row`, `control` and `panel` washes.
   */
  selected?: boolean;
};

/**
 * A clickable surface whose content is its look: a card, a calendar event, a tab, a canvas
 * item. It adds button semantics and disabled handling, and with `wash` one of the shared hover
 * looks; otherwise the content draws its own hover and focus states, since focus rings are off
 * app-wide. Anything that looks like a button uses Button or IconButton instead.
 */
const Pressable = React.forwardRef<HTMLButtonElement, PressableProps>(
  ({ className, type = "button", wash, selected, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="pressable"
      data-wash={wash}
      data-selected={selected || undefined}
      className={cn(
        "cursor-pointer text-left outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Pressable.displayName = "Pressable";

export { Pressable };

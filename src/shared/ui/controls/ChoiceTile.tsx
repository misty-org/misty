import * as React from "react";
import { cn } from "../classNames";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { Tooltip } from "../overlays/Tooltip";

export type ChoiceTileProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "title" | "type"
> & {
  /** What the tile picks: its accessible name, and its tooltip when there is no caption. */
  label: string;
  /** The picture: an avatar, an emoji, a color or a preview. It is drawn as given. */
  children: React.ReactNode;
  /** The one picked in its set: a filled tile. */
  selected: boolean;
  onSelect: () => void;
  /** A short name under the picture; it fades when the tile is narrow. */
  caption?: string;
  /** `outline` draws the tile's edge, for tiles that sit on a bare surface. Default `plain`. */
  look?: "plain" | "outline";
};

/**
 * One choice in a grid of pictures, such as an agent's avatar or a Space's emoji. The picked tile
 * is filled; the rest wash on hover. Put a set of them in a grid with an accessible name.
 *
 * ```tsx
 * <ChoiceTile label="Sunny" caption="Sunny" selected={avatar === "sunny"} onSelect={() => pick("sunny")}>
 *   <AgentCloudImage variant={sunny} />
 * </ChoiceTile>
 * ```
 */
const ChoiceTile = React.forwardRef<HTMLButtonElement, ChoiceTileProps>(
  ({ label, children, selected, onSelect, caption, look = "plain", className, ...props }, ref) => {
    const tile = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={selected}
        data-slot="choice-tile"
        data-look={look}
        className={cn(
          "grid min-w-0 justify-items-center gap-1 rounded-md border border-transparent p-2",
          "text-cream outline-none transition-colors select-none",
          "hover:bg-control-hover focus-visible:bg-control-hover",
          "aria-pressed:bg-control-active aria-pressed:text-cream-bright",
          "data-[look=outline]:border-charcoal-border",
          "data-[look=outline]:aria-pressed:border-charcoal-border-strong",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        onClick={onSelect}
        {...props}
      >
        {children}
        {caption ? (
          <OverflowFadeText className="max-w-full text-caption text-cream-muted">
            {caption}
          </OverflowFadeText>
        ) : null}
      </button>
    );
    return caption ? tile : <Tooltip content={label}>{tile}</Tooltip>;
  },
);
ChoiceTile.displayName = "ChoiceTile";

export { ChoiceTile };

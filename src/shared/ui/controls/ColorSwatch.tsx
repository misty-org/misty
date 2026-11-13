import { Palette } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";

type SwatchShape = "circle" | "square";

const swatchClass = (shape: SwatchShape) =>
  cn(
    "size-5 shrink-0 border border-charcoal-border outline-none transition-[box-shadow,border-color]",
    "hover:border-cream-muted focus-visible:border-cream",
    // The selected mark is a shadow, not a ring: the app clears rings on focus, and the swatch
    // just picked keeps focus.
    "aria-pressed:shadow-[0_0_0_1px_var(--color-charcoal-card),0_0_0_3px_var(--color-cream)]",
    "aria-checked:shadow-[0_0_0_1px_var(--color-charcoal-card),0_0_0_3px_var(--color-cream)]",
    shape === "circle" ? "rounded-full" : "rounded-md",
  );

type ColorSwatchProps = Omit<React.ComponentPropsWithoutRef<"button">, "color" | "children"> & {
  /** Any CSS color; swatches show user or document colors, not theme tokens. */
  color: string;
  label: string;
  selected?: boolean;
  shape?: SwatchShape;
  /**
   * A radio in a `radiogroup` instead of a toggle: the picked swatch is `aria-checked` rather
   * than `aria-pressed`, with the same mark.
   */
  radio?: boolean;
};

/** One pickable color. Pens, highlighters, and backgrounds all use these. */
const ColorSwatch = React.forwardRef<HTMLButtonElement, ColorSwatchProps>(
  (
    { color, label, selected = false, shape = "circle", radio = false, className, style, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type="button"
      data-slot="color-swatch"
      role={radio ? "radio" : undefined}
      aria-label={label}
      aria-pressed={radio ? undefined : selected}
      aria-checked={radio ? selected : undefined}
      className={cn(swatchClass(shape), className)}
      style={{ ...style, backgroundColor: color }}
      {...props}
    />
  ),
);
ColorSwatch.displayName = "ColorSwatch";

type CustomColorSwatchProps = {
  value: string;
  label: string;
  onChange: (color: string) => void;
};

/** Opens the system color picker; sits after a row of ColorSwatches, at their size. */
function CustomColorSwatch({ value, label, onChange }: CustomColorSwatchProps) {
  return (
    <label
      data-slot="custom-color-swatch"
      className={cn(
        "relative grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-cream-muted",
        "transition-colors hover:bg-control-hover hover:text-cream focus-within:bg-control-hover focus-within:text-cream",
      )}
    >
      <Palette className="pointer-events-none size-3.5" />
      <input
        type="color"
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * A color shown, not picked: a small square of it beside a value such as `rgb(…)`, so the value
 * reads as the color it is. A faint inner edge keeps it visible on a fill of the same color.
 */
function ColorChip({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="color-chip"
      className={cn(
        "size-2.5 shrink-0 rounded-sm",
        "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--misty-theme-text)_25%,transparent)]",
        className,
      )}
      style={{ background: color }}
    />
  );
}

export { ColorChip, ColorSwatch, CustomColorSwatch };

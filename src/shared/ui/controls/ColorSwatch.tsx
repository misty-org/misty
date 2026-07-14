import { Palette } from "lucide-react";
import * as React from "react";
import { cn } from "../utils";

type SwatchShape = "circle" | "square";

const swatchClass = (shape: SwatchShape) =>
  cn(
    "size-5 shrink-0 border border-charcoal-border outline-none transition-[box-shadow,transform]",
    "hover:scale-110 focus-visible:ring-2 focus-visible:ring-cream-muted",
    "aria-pressed:ring-2 aria-pressed:ring-cream aria-pressed:ring-offset-1 aria-pressed:ring-offset-charcoal-card",
    shape === "circle" ? "rounded-full" : "rounded-md",
  );

type ColorSwatchProps = Omit<React.ComponentPropsWithoutRef<"button">, "color" | "children"> & {
  /** Any CSS color; swatches show user or document colors, not theme tokens. */
  color: string;
  label: string;
  selected?: boolean;
  shape?: SwatchShape;
};

/** One pickable color. Pens, highlighters, and backgrounds all use these. */
const ColorSwatch = React.forwardRef<HTMLButtonElement, ColorSwatchProps>(
  ({ color, label, selected = false, shape = "circle", className, style, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-slot="color-swatch"
      aria-label={label}
      aria-pressed={selected}
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
  title?: string;
  onChange: (color: string) => void;
};

/** Opens the system color picker; sits after a row of ColorSwatches. */
function CustomColorSwatch({ value, label, title, onChange }: CustomColorSwatchProps) {
  return (
    <label
      data-slot="custom-color-swatch"
      title={title ?? label}
      className={cn(
        "relative grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-cream-muted",
        "transition-colors hover:bg-cream/[0.045] hover:text-cream focus-within:ring-2 focus-within:ring-cream-muted",
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

export { ColorSwatch, CustomColorSwatch };

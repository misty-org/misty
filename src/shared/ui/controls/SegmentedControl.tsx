import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";
import { cn } from "../utils";

type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Accessible name when `label` alone is not descriptive enough. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Explains a disabled option, e.g. why it is unavailable. */
  title?: string;
  /** Extra attributes for the option's button, e.g. data hooks. */
  attributes?: Record<`data-${string}`, string>;
};

type SegmentedControlProps<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  size?: "xs" | "sm";
  disabled?: boolean;
  /** Layout only: margins, alignment, or width. */
  className?: string;
  /** Stretch options to fill the track. */
  fill?: boolean;
};

const itemSizes = {
  xs: "h-6 gap-1 px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3",
  sm: "h-7 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
} as const;

/**
 * A pill track of mutually exclusive choices, such as view modes or Search/Ask. It is a radio
 * group: the chosen option is the tab stop, and arrow keys, Home, and End change the choice.
 * Features never draw their own segmented pills.
 */
function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "sm",
  disabled,
  className,
  fill = false,
}: SegmentedControlProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      disabled={disabled}
      orientation="horizontal"
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full border border-charcoal-border/70 bg-charcoal-sidebar p-0.5",
        fill ? "w-full" : "w-fit",
        className,
      )}
      onValueChange={(next) => onChange(next as T)}
      onKeyDown={(event) => {
        // Arrow keys already choose as they move; Home and End choose the ends too.
        if (disabled || (event.key !== "Home" && event.key !== "End")) return;
        const available = options.filter((option) => !option.disabled);
        const edge = event.key === "Home" ? available[0] : available[available.length - 1];
        if (edge && edge.value !== value) onChange(edge.value);
      }}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          disabled={option.disabled}
          title={option.title}
          {...option.attributes}
          className={cn(
            "inline-flex min-w-0 items-center justify-center whitespace-nowrap rounded-full font-medium text-cream-muted outline-none transition-colors",
            "hover:bg-control-hover hover:text-cream",
            "data-[state=checked]:bg-charcoal-active data-[state=checked]:text-cream-bright data-[state=checked]:shadow-sm",
            "focus-visible:ring-2 focus-visible:ring-cream/15 disabled:pointer-events-none disabled:opacity-50",
            "[&_svg]:pointer-events-none [&_svg]:shrink-0",
            itemSizes[size],
            fill && "flex-1",
          )}
        >
          {option.icon}
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

export { SegmentedControl };
export type { SegmentedControlProps, SegmentedOption };

import * as TogglePrimitive from "@radix-ui/react-toggle";
import * as React from "react";
import { cn } from "../classNames";
import { renderIcon, type IconSource } from "../layout/ActionBar";
import { OverflowFadeText } from "../layout/OverflowFadeText";

export type FilterChipProps = Omit<
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>,
  "children" | "pressed" | "defaultPressed" | "onPressedChange" | "asChild"
> & {
  pressed: boolean;
  label: string;
  onPressedChange: (pressed: boolean) => void;
  icon?: IconSource;
  /** sm 24, md 32 (default). */
  size?: "sm" | "md";
};

const sizeClass = {
  sm: "h-6 gap-1 px-2",
  md: "h-8 gap-1.5 px-3",
} as const;

/**
 * A filter that is on or off, such as a section tab over a list: outlined until pressed, then
 * filled. A row of them sits in an ActionBar or a Toolbar; for one choice out of several that
 * always has an answer, use ChoiceGroup.
 *
 * ```tsx
 * <FilterChip label="Unread" pressed={filter === "unread"}
 *   onPressedChange={(on) => setFilter(on ? "unread" : "all")} />
 * ```
 */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ pressed, label, onPressedChange, icon, size = "md", className, ...props }, ref) => (
    <TogglePrimitive.Root
      ref={ref}
      type="button"
      data-slot="filter-chip"
      data-size={size}
      pressed={pressed}
      onPressedChange={onPressedChange}
      className={cn(
        "inline-flex max-w-full min-w-0 shrink-0 items-center justify-center rounded-md border",
        "border-charcoal-border text-control font-medium whitespace-nowrap text-cream-muted",
        "outline-none select-none hover:bg-control-hover hover:text-cream",
        // Focus rings are off app-wide, so keyboard focus shows as the hover wash.
        "focus-visible:bg-control-hover focus-visible:text-cream",
        "data-[state=on]:border-transparent data-[state=on]:bg-charcoal-active data-[state=on]:text-cream-bright",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {renderIcon(icon)}
      <OverflowFadeText>
        {label}
      </OverflowFadeText>
    </TogglePrimitive.Root>
  ),
);
FilterChip.displayName = "FilterChip";

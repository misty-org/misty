import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";
import { cn } from "../classNames";
import { renderIcon, type IconSource } from "../layout/ActionBar";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { Tooltip } from "../overlays/Tooltip";

export type ChoiceGroupOption<T extends string> = {
  value: T;
  /** Shown as the text, or as the tooltip and accessible name when `iconOnly`. */
  label: string;
  icon?: IconSource;
  /** Shows only the icon; the label becomes its tooltip. Needs `icon`. */
  iconOnly?: boolean;
  disabled?: boolean;
  /** Why a disabled option can't be chosen, shown in its tooltip. */
  reason?: string;
  /**
   * The shortcut that picks it, as it reads ("⌘1"), shown after the label in its tooltip while
   * shortcut hints are on. A text option with a shortcut gets a tooltip for it.
   */
  shortcut?: string;
};

export type ChoiceGroupProps<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: ReadonlyArray<ChoiceGroupOption<T>>;
  onChange: (value: T) => void;
  /** sm 24, md 32 (default). The track is inside that height. */
  size?: "sm" | "md";
  disabled?: boolean;
  /** Stretch the options to fill the row; long labels then fade. */
  fill?: boolean;
  /** Layout only: margins or alignment. */
  className?: string;
};

const trackSize = {
  sm: "h-6 rounded-md",
  md: "h-8 rounded-lg",
} as const;

const itemSize = {
  sm: "rounded-sm px-2",
  md: "rounded-md px-2.5",
} as const;

// About square inside the track: 18px tall at sm, 26px at md.
const iconOnlySize = { sm: "w-5 px-0", md: "w-7 px-0" } as const;

/**
 * The one segmented control: mutually exclusive choices on a track, such as a view mode or
 * Month/Agenda. It is a radio group, so the chosen option is the tab stop and arrow keys, Home and
 * End move the choice. The whole control, track included, is one control height, so it lines up
 * with buttons in the same row.
 *
 * ```tsx
 * <ChoiceGroup label="Calendar view" value={view} onChange={setView}
 *   options={[{ value: "month", label: "Month" }, { value: "agenda", label: "Agenda" }]} />
 * ```
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
  disabled,
  fill = false,
  className,
}: ChoiceGroupProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      disabled={disabled}
      orientation="horizontal"
      aria-label={label}
      data-slot="choice-group"
      data-size={size}
      className={cn(
        "flex min-w-0 shrink-0 items-stretch gap-0.5 border border-charcoal-border bg-charcoal-sidebar p-0.5",
        trackSize[size],
        fill ? "w-full" : "w-fit",
        disabled && "opacity-50",
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
      {options.map((option) => {
        const iconOnly = Boolean(option.iconOnly && option.icon);
        const item = (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-label={iconOnly ? option.label : undefined}
            className={cn(
              "inline-flex min-w-0 items-center justify-center gap-1.5 leading-none whitespace-nowrap",
              "text-control font-medium text-cream-muted outline-none select-none",
              "hover:bg-control-hover hover:text-cream",
              // Focus rings are off app-wide, so keyboard focus shows as the hover wash.
              "focus-visible:bg-control-hover focus-visible:text-cream",
              "data-[state=checked]:bg-charcoal-active data-[state=checked]:text-cream-bright",
              "disabled:pointer-events-none disabled:opacity-50",
              "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              itemSize[size],
              iconOnly && iconOnlySize[size],
              fill && !iconOnly && "flex-1",
            )}
          >
            {renderIcon(option.icon)}
            {iconOnly ? null : <OverflowFadeText>{option.label}</OverflowFadeText>}
          </RadioGroupPrimitive.Item>
        );
        // A disabled button gets no pointer events, so the reason hangs on a wrapper around it.
        if (option.disabled && option.reason)
          return (
            <Tooltip key={option.value} content={option.reason}>
              <span className={cn("flex min-w-0", fill && !iconOnly && "flex-1")}>{item}</span>
            </Tooltip>
          );
        if (iconOnly || option.shortcut)
          return (
            <Tooltip key={option.value} content={option.label} shortcut={option.shortcut}>
              {item}
            </Tooltip>
          );
        return item;
      })}
    </RadioGroupPrimitive.Root>
  );
}

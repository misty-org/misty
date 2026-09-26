"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "./utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(
  (
    {
      className,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      "aria-valuetext": ariaValueText,
      ...props
    },
    ref,
  ) => (
    <SliderPrimitive.Root
      ref={ref}
      data-slot="slider"
      className={cn(
        "relative flex min-h-6 w-full touch-none select-none items-center",
        "data-[disabled]:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/10 data-[disabled]:opacity-50"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-cream-bright data-[disabled]:bg-cream-muted"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-valuetext={ariaValueText}
        className={cn(
          "relative block size-4 shrink-0 rounded-full bg-cream-bright shadow-sm outline-none",
          "transition-[box-shadow] duration-150 after:absolute after:-inset-2 after:content-['']",
          "hover:ring-4 hover:ring-cream/15 focus-visible:ring-4 focus-visible:ring-cream/25",
          "data-[disabled]:pointer-events-none data-[disabled]:bg-cream-muted",
        )}
      />
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

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
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-charcoal-hover data-[disabled]:bg-charcoal-bg"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-cream-muted transition-colors data-[disabled]:bg-charcoal-border"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-valuetext={ariaValueText}
        className={cn(
          "relative block size-[18px] rounded-full border-2 border-charcoal-bg bg-cream-bright",
          "shadow-sm ring-1 ring-cream/20 outline-none transition-[background-color,box-shadow,transform] duration-150 ease-out",
          "after:absolute after:-inset-2 after:content-[''] hover:scale-105 focus-visible:ring-[3px]",
          "focus-visible:ring-cream-muted/40 data-[disabled]:pointer-events-none data-[disabled]:border-charcoal-border",
          "data-[disabled]:bg-charcoal-border data-[disabled]:ring-charcoal-border data-[disabled]:shadow-none",
        )}
      />
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

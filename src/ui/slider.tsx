"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/ui";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    data-slot="slider"
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track
      data-slot="slider-track"
      className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-charcoal-hover"
    >
      <SliderPrimitive.Range className="absolute h-full bg-charcoal-active" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        "block size-4 rounded-full border border-charcoal-active bg-charcoal-bg",
        "shadow-xs outline-none transition-shadow focus-visible:ring-[3px]",
        "focus-visible:ring-charcoal-active/40 disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

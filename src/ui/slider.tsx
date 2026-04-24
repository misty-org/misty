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
    {/*
      The track and thumb mix against --misty-bg rather than using bg-muted /
      bg-background. Those map to --misty-runtime-*, which the desktop frame
      sets to `transparent` so translucent panels can show the wallpaper — so
      the unfilled track and the thumb interior rendered as nothing at all.
      Mixing the foreground into --misty-bg keeps both readable, and inverts
      correctly across every theme because both tokens are per-theme colors.
      This matches how Switch builds its track and thumb.
    */}
    <SliderPrimitive.Track
      data-slot="slider-track"
      className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--foreground)_18%,var(--misty-bg))]"
    >
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        "block size-4 rounded-full border border-primary bg-[var(--misty-bg)]",
        "shadow-xs outline-none transition-shadow focus-visible:ring-[3px]",
        "focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { popoverContentClass } from "./menu-styles";
import { cn } from "./utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, forceMount, ...props }, ref) => (
  <PopoverPrimitive.Portal forceMount={forceMount}>
    <PopoverPrimitive.Content
      ref={ref}
      forceMount={forceMount}
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(popoverContentClass, className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };

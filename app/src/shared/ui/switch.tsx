import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "./utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    data-slot="switch"
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border",
      "border-cream/10 bg-charcoal-hover",
      "shadow-xs outline-none transition-colors duration-150 ease-out focus-visible:border-charcoal-active",
      "focus-visible:ring-[3px] focus-visible:ring-charcoal-active/40 disabled:cursor-not-allowed",
      "disabled:opacity-50 data-[state=checked]:border-charcoal-active data-[state=checked]:bg-charcoal-active",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      data-slot="switch-thumb"
      className={cn(
        "pointer-events-none block size-4 rounded-full bg-charcoal-bg shadow-sm",
        "ring-1 ring-cream/15 transition-transform duration-150 ease-out data-[state=checked]:translate-x-4",
        "data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

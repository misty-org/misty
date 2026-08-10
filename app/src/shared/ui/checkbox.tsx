import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "./utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      "peer grid size-4 shrink-0 place-content-center rounded-[4px] border border-charcoal-border bg-transparent shadow-xs outline-none transition-shadow focus-visible:border-charcoal-active focus-visible:ring-[3px] focus-visible:ring-charcoal-active/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-charcoal-active data-[state=checked]:bg-charcoal-active data-[state=checked]:text-cream-bright",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("grid place-content-center text-current")}>
      <Check className="size-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

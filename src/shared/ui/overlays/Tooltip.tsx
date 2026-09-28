import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "../utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

type TooltipSide = "top" | "right" | "bottom" | "left";
const TooltipSideContext = React.createContext<TooltipSide | undefined>(undefined);
/** Points navigation hints toward the workspace, including through portals. */
const TooltipSideProvider = TooltipSideContext.Provider;

function TooltipHint({
  children,
  content,
}: {
  children: React.ReactElement;
  content: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, side, sideOffset, collisionPadding = 8, children, ...props }, ref) => {
  const navigationSide = React.useContext(TooltipSideContext);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        data-navigation-tooltip={navigationSide ? "true" : undefined}
        side={side ?? navigationSide}
        sideOffset={sideOffset ?? (navigationSide ? 10 : 4)}
        collisionPadding={collisionPadding}
        className={cn(
          "layer-tooltip rounded-md bg-charcoal-card px-2.5 py-1.5",
          "max-w-[min(20rem,var(--radix-tooltip-content-available-width))] whitespace-normal break-words",
          "text-xs text-cream shadow-lg ring-1 ring-cream/10",
          navigationSide && "px-3 py-2 text-sm font-medium",
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          "origin-center",
          className,
        )}
        {...props}
      >
        {children}
        {navigationSide && (
          <TooltipPrimitive.Arrow className="fill-charcoal-card" width={10} height={5} />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TooltipHint,
  TooltipSideProvider,
};

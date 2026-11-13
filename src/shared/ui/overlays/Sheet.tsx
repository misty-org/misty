import { cn } from "../classNames";
import { OutOfRow } from "../controls/rowContext";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { IconButton } from "../controls/IconButton";

const Sheet = SheetPrimitive.Root;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    data-slot="sheet-overlay"
    className={cn(
      "fixed inset-0 layer-dialog-backdrop bg-scrim duration-200",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "data-[state=closed]:pointer-events-none",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  [
    "fixed layer-dialog gap-4 bg-charcoal-card p-6 text-body text-cream shadow-xl",
    "transition ease-out data-[state=closed]:duration-200",
    "data-[state=open]:duration-300 data-[state=open]:animate-in",
    "data-[state=closed]:animate-out data-[state=closed]:pointer-events-none",
  ],
  {
    variants: {
      side: {
        top:
          "inset-x-0 top-[var(--misty-modal-inset-top,0px)] border-b " +
          "border-charcoal-border data-[state=closed]:slide-out-to-top " +
          "data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t border-charcoal-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left:
          "bottom-0 top-[var(--misty-modal-inset-top,0px)] left-0 w-3/4 border-r " +
          "border-charcoal-border data-[state=closed]:slide-out-to-left " +
          "data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 w-3/4 border-l border-charcoal-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(
  (
    {
      side = "right",
      className,
      children,
      showCloseButton = true,
      portal = true,
      container,
      overlay = true,
      docked = false,
      ...props
    },
    ref,
  ) => {
    const content = (
      <>
        {overlay ? <SheetOverlay /> : null}
        <SheetPrimitive.Content
          ref={ref}
          data-slot="sheet-content"
          data-side={side}
          className={cn(sheetVariants({ side }), docked && dockedClass, className)}
          {...props}
        >
          {showCloseButton ? (
            <SheetPrimitive.Close asChild>
              <IconButton
                label="Close"
                variant="quiet"
                data-slot="sheet-close"
                className="absolute right-4 top-4"
              >
                <X />
              </IconButton>
            </SheetPrimitive.Close>
          ) : null}
          <OutOfRow>{children}</OutOfRow>
        </SheetPrimitive.Content>
      </>
    );

    if (portal === false) {
      return content;
    }

    return <SheetPortal container={container}>{content}</SheetPortal>;
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    data-slot="sheet-title"
    className={cn("text-title font-semibold text-cream-bright", className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    data-slot="sheet-description"
    className={cn("text-body text-cream-muted", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export { Sheet, SheetContent, SheetDescription, SheetTitle };

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  showCloseButton?: boolean;
  portal?: boolean;
  container?: HTMLElement | null;
  overlay?: boolean;
  /**
   * Docked in its page instead of over the window (with `portal={false}` inside a positioned
   * page): it runs the page's full height at its side on the sidebar's fill, with no padding,
   * shadow or slide, and never wider than the page. Its width is the caller's (`w-105`).
   */
  docked?: boolean;
}

const dockedClass = cn(
  "absolute inset-y-0 gap-0 p-0 bg-charcoal-sidebar shadow-none max-w-full sm:max-w-full",
  "data-[state=open]:animate-none data-[state=closed]:animate-none",
);

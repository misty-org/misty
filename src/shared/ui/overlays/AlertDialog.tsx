"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";

import { Button, type ButtonProps } from "../controls/Button";
import { cn } from "../classNames";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    data-slot="alert-dialog-overlay"
    className={cn(
      "fixed inset-0 layer-blocking-backdrop bg-scrim duration-160",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

/** sm (384) for a short confirmation, md (512, the default) when it holds more. */
type AlertDialogSize = "sm" | "md";

const alertDialogSizeClass: Record<AlertDialogSize, string> = { sm: "max-w-sm", md: "max-w-lg" };

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & { size?: AlertDialogSize }
>(({ className, size = "md", ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <div
      data-slot="alert-dialog-positioner"
      className="pointer-events-none fixed inset-0 layer-blocking-popup flex items-center justify-center pt-[var(--misty-modal-inset-top,0px)]"
    >
      <AlertDialogPrimitive.Content
        ref={ref}
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "pointer-events-auto relative grid",
          "max-h-[calc(100dvh-4rem-var(--misty-modal-inset-top,0px))] w-[calc(100%-2rem)]",
          alertDialogSizeClass[size],
          "gap-4 overflow-y-auto rounded-xl bg-charcoal-card p-6",
          "text-body text-cream shadow-xl ring-1 ring-cream/10 misty-dialog-motion",
          className,
        )}
        {...props}
      />
    </div>
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="alert-dialog-header"
    className={cn("flex flex-col gap-2 text-left", className)}
    {...props}
  />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

/** Buttons at the end of the dialog, right-aligned: Cancel, then the action. */
const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="alert-dialog-footer"
    className={cn("flex items-center justify-end gap-2", className)}
    {...props}
  />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    data-slot="alert-dialog-title"
    className={cn("text-title font-semibold text-cream-bright", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    data-slot="alert-dialog-description"
    className={cn("text-body text-cream-muted", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

type AlertDialogButtonProps = React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & {
  /** `danger` for a delete (ConfirmDeleteDialog already does this); otherwise `primary`. */
  variant?: ButtonProps["variant"];
  /** Working on the click: a spinner replaces the icon, the label stays, and clicks wait. */
  loading?: boolean;
};

/**
 * The dialog's action, a 36px button. A delete uses ConfirmDeleteDialog instead of building
 * one from these parts.
 */
const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  AlertDialogButtonProps
>(({ className, variant = "primary", loading, children, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} data-slot="alert-dialog-action" {...props} asChild>
    <Button variant={variant} size="lg" loading={loading} className={className}>
      {children}
    </Button>
  </AlertDialogPrimitive.Action>
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

/** Cancel: a quiet 36px button. */
const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  AlertDialogButtonProps
>(({ className, variant = "quiet", loading, children, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel ref={ref} data-slot="alert-dialog-cancel" {...props} asChild>
    <Button variant={variant} size="lg" loading={loading} className={className}>
      {children}
    </Button>
  </AlertDialogPrimitive.Cancel>
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
export type { AlertDialogSize };

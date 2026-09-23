import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "./utils";

function cleanupPointerEvents() {
  if (typeof document === "undefined") return;
  const modalOpen =
    document.querySelector("[data-slot='dialog-content'][data-state='open']") ||
    document.querySelector("[data-slot='alert-dialog-content'][data-state='open']");
  if (!modalOpen) {
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
    if (document.documentElement.style.pointerEvents === "none") {
      document.documentElement.style.pointerEvents = "";
    }
    for (const cls of Array.from(document.body.classList)) {
      if (cls.startsWith("block-interactivity-")) {
        document.body.classList.remove(cls);
      }
    }
    if (document.body.hasAttribute("data-scroll-locked")) {
      document.body.removeAttribute("data-scroll-locked");
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", cleanupPointerEvents, { capture: true, passive: true });
}

const Dialog = ({
  open,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) => {
  React.useEffect(() => {
    if (!open) {
      cleanupPointerEvents();
      const t1 = window.setTimeout(cleanupPointerEvents, 50);
      const t2 = window.setTimeout(cleanupPointerEvents, 200);
      const t3 = window.setTimeout(cleanupPointerEvents, 350);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.clearTimeout(t3);
      };
    }
  }, [open]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen);
      if (!nextOpen) {
        cleanupPointerEvents();
        window.setTimeout(cleanupPointerEvents, 50);
        window.setTimeout(cleanupPointerEvents, 200);
        window.setTimeout(cleanupPointerEvents, 350);
      }
    },
    [onOpenChange],
  );

  return <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />;
};

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      "fixed inset-0 z-[2147483000] bg-black/45 duration-160 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    container?: HTMLElement | null;
  }
>(({ className, children, container, ...props }, ref) => {
  React.useEffect(() => {
    return () => {
      cleanupPointerEvents();
      window.setTimeout(cleanupPointerEvents, 50);
      window.setTimeout(cleanupPointerEvents, 200);
      window.setTimeout(cleanupPointerEvents, 350);
    };
  }, []);

  return (
    <DialogPortal container={container}>
      <DialogOverlay className={container ? "absolute inset-0" : undefined} />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          container
            ? "absolute left-1/2 top-1/2 z-[2147483100] grid -translate-x-1/2 -translate-y-1/2"
            : "fixed left-1/2 top-1/2 z-[2147483100] grid -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg",
          "gap-4 overflow-y-auto rounded-xl bg-charcoal-card p-6",
          "text-cream shadow-xl ring-1 ring-cream/10 duration-160 ease-out",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[state=closed]:pointer-events-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-md text-cream-muted outline-none transition-colors hover:bg-charcoal-card hover:text-cream focus-visible:ring-[3px] focus-visible:ring-charcoal-active/40 disabled:pointer-events-none"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-header"
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn("font-heading text-lg font-medium leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn("text-sm text-cream-muted", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};

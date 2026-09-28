import * as DialogPrimitive from "@radix-ui/react-dialog";
import type * as React from "react";
import { cn } from "../utils";

type BlockingScreenProps = {
  /** Artwork above the title, such as the Misty mark or a button made of it. */
  media?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Data hooks for the content element, e.g. { "data-device-sync-sleep": "" }. */
  attributes?: Record<`data-${string}`, string>;
};

/**
 * A full-window screen below the title bar that the person cannot dismiss, such as device
 * sync asking which device continues. The window can still be moved and closed.
 */
function BlockingScreen({ media, title, description, children, attributes }: BlockingScreenProps) {
  return (
    <DialogPrimitive.Root open modal={false}>
      <DialogPrimitive.Portal>
        <div
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 top-[38px] layer-blocking-backdrop bg-black/75 backdrop-blur-sm"
        />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          {...attributes}
          className={cn(
            "fixed inset-x-0 bottom-0 top-[38px] layer-blocking flex flex-col",
            "items-center justify-center overflow-y-auto p-8 text-center text-cream",
            "outline-none",
          )}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {media}
          <DialogPrimitive.Title className="text-xl font-medium tracking-tight">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-3 max-w-sm text-sm leading-relaxed text-cream-muted">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { BlockingScreen };
export type { BlockingScreenProps };

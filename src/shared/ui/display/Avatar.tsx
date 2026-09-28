import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

import { cn } from "../utils";

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
    size?: "default" | "sm" | "lg";
    /**
     * `tile` sits in an icon slot like a glyph: a square with soft corners and no ring,
     * so any uploaded picture crops to the same footprint as the icons around it.
     */
    shape?: "circle" | "tile";
  }
>(({ className, size = "default", shape = "circle", ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    data-slot="avatar"
    data-size={size}
    data-shape={shape}
    className={cn(
      "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full border border-charcoal-border bg-charcoal-card text-cream-bright select-none data-[size=lg]:size-10 data-[size=sm]:size-6",
      "data-[shape=tile]:rounded-[28%] data-[shape=tile]:border-0 data-[shape=tile]:bg-transparent",
      "data-[shape=tile]:[container-type:size]",
      className,
    )}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    data-slot="avatar-image"
    className={cn(
      "aspect-square size-full rounded-full object-cover group-data-[shape=tile]/avatar:rounded-[inherit]",
      className,
    )}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    data-slot="avatar-fallback"
    className={cn(
      "flex size-full items-center justify-center rounded-full bg-charcoal-card text-sm font-medium text-cream-bright group-data-[size=sm]/avatar:text-xs",
      // Tile initials scale with the tile instead of a fixed text size.
      "group-data-[shape=tile]/avatar:rounded-[inherit] group-data-[shape=tile]/avatar:text-[length:42cqi] group-data-[shape=tile]/avatar:font-semibold",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

const AvatarBadge = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span">>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="avatar-badge"
      className={cn(
        "absolute bottom-0 right-0 z-10 inline-flex items-center justify-center rounded-full bg-status-green text-cream-bright ring-2 ring-charcoal-sidebar select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className,
      )}
      {...props}
    />
  ),
);
AvatarBadge.displayName = "AvatarBadge";

const AvatarGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-charcoal-bg",
        className,
      )}
      {...props}
    />
  ),
);
AvatarGroup.displayName = "AvatarGroup";

const AvatarGroupCount = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-charcoal-card text-sm text-cream-muted ring-2 ring-charcoal-bg group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className,
      )}
      {...props}
    />
  ),
);
AvatarGroupCount.displayName = "AvatarGroupCount";

export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage };

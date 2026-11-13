import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

import { cn } from "../classNames";
import type { ItemTone } from "../icons/itemTones";

/** xs 16 (inline beside text), sm 24, default 32, lg 40, xl 64 (a profile or a Space's page). */
export type AvatarSize = "xs" | "sm" | "default" | "lg" | "xl";

/**
 * A fill for initials with no picture, such as a Space's own color: one of the item tones, with
 * the dark ink that reads on every one of them.
 */
export type AvatarTone = ItemTone;

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
    size?: AvatarSize;
    /**
     * `tile` sits in an icon slot like a glyph: a square with soft corners and no ring,
     * so any uploaded picture crops to the same footprint as the icons around it.
     */
    shape?: "circle" | "tile";
    /** Paints the fallback (the initials) in this tone. A picture, once loaded, covers it. */
    tone?: AvatarTone;
  }
>(({ className, size = "default", shape = "circle", tone, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    data-slot="avatar"
    data-size={size}
    data-shape={shape}
    data-tone={tone}
    className={cn(
      "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full border border-charcoal-border bg-charcoal-card text-cream-bright select-none",
      "data-[size=xs]:size-4 data-[size=sm]:size-6 data-[size=lg]:size-10 data-[size=xl]:size-16",
      "data-[tone]:border-0",
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
      "flex size-full items-center justify-center rounded-full bg-charcoal-card",
      "text-control font-medium text-cream-bright group-data-[size=sm]/avatar:text-caption",
      "group-data-[size=xs]/avatar:text-micro group-data-[size=xl]/avatar:text-title",
      // A tone fills the initials with its color and dark ink. Written out so Tailwind keeps them.
      "group-data-[tone]/avatar:text-ink-on-color",
      "group-data-[tone=blue]/avatar:bg-tone-blue group-data-[tone=red]/avatar:bg-tone-red",
      "group-data-[tone=green]/avatar:bg-tone-green group-data-[tone=orange]/avatar:bg-tone-orange",
      "group-data-[tone=violet]/avatar:bg-tone-violet group-data-[tone=pink]/avatar:bg-tone-pink",
      "group-data-[tone=amber]/avatar:bg-tone-amber group-data-[tone=teal]/avatar:bg-tone-teal",
      "group-data-[tone=sand]/avatar:bg-tone-sand",
      // Tile initials scale with the tile instead of a fixed text size.
      "group-data-[shape=tile]/avatar:rounded-[inherit] group-data-[shape=tile]/avatar:text-[length:42cqi] group-data-[shape=tile]/avatar:font-semibold",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarFallback, AvatarImage };

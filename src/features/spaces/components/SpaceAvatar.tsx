import { Layers } from "lucide-react";
import type { Space } from "../api/dto/entities";
import { Avatar, AvatarFallback, cn } from "@/shared/ui";

/**
 * A Space with no picture of its own shows a gray tile with a layers glyph, never initials, so it
 * can't be mistaken for the person's own avatar, which is a colored tile with their initial.
 */
export function SpaceAvatar({
  space,
  className,
}: {
  space: Space;
  className?: string;
  /** Kept for callers that size initials; the default glyph scales with the tile. */
  fallbackClassName?: string;
}) {
  return (
    <Avatar
      shape="tile"
      className={cn("shrink-0", className)}
      aria-label={`${space.name} default picture`}
    >
      <AvatarFallback className="bg-cream/[0.14] text-cream-bright">
        <Layers className="size-[60%]" strokeWidth={1.75} aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  );
}

export function spaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "S";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`.toUpperCase();
}

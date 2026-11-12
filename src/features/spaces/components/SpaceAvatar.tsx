import type { CSSProperties } from "react";
import type { Space } from "../api/dto/entities";
import { Avatar, AvatarFallback, cn } from "@/shared/ui";

const tones = ["blue", "teal", "violet", "orange", "pink", "green", "amber", "red"] as const;

/** The same Space always gets the same color, on every device, from its id. */
export function spaceTone(id: string): (typeof tones)[number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

/**
 * A Space's picture: a tile in the Space's own color with two initials. The person's avatar is a
 * gray tile with one initial, so the two never read as each other.
 */
export function SpaceAvatar({
  space,
  className,
  fallbackClassName,
}: {
  space: Pick<Space, "id" | "name">;
  className?: string;
  fallbackClassName?: string;
}) {
  const tone = `var(--color-tone-${spaceTone(space.id)})`;
  const style: CSSProperties = {
    background: `linear-gradient(140deg, color-mix(in srgb, ${tone} 88%, white), color-mix(in srgb, ${tone} 62%, black))`,
  };
  return (
    <Avatar shape="tile" className={cn("shrink-0", className)} aria-label={`${space.name} picture`}>
      <AvatarFallback
        className={cn("font-semibold tracking-tight text-white", fallbackClassName)}
        style={style}
      >
        {spaceInitials(space.name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function spaceInitials(name: string): string {
  const words = name
    .trim()
    // "Ada's Space" reads as A and S, not A and the apostrophe's s.
    .replace(/['’]s\b/gi, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "S";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`.toUpperCase();
}

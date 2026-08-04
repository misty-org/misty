import { Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, cn } from "@/ui";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { isMistySpace } from "../mistySpace";

const avatarPalettes = [
  "bg-violet-500/20 text-violet-700 dark:text-violet-200",
  "bg-sky-500/20 text-sky-700 dark:text-sky-200",
  "bg-emerald-500/20 text-emerald-700 dark:text-emerald-200",
  "bg-amber-500/20 text-amber-700 dark:text-amber-200",
  "bg-rose-500/20 text-rose-700 dark:text-rose-200",
  "bg-cyan-500/20 text-cyan-700 dark:text-cyan-200",
] as const;

export function SpaceAvatar({ space, className }: { space: Space; className?: string }) {
  if (isMistySpace(space)) {
    return (
      <Avatar
        className={cn("shrink-0 rounded-full", className)}
        aria-label="Misty Space profile picture"
      >
        <AvatarFallback className="rounded-full bg-violet-500/20 text-violet-700 dark:text-violet-200">
          <Sparkles className="size-4" strokeWidth={1.8} aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
    );
  }
  const initials = spaceInitials(space.name);
  const palette = avatarPalettes[stableSpacePaletteIndex(space.id, avatarPalettes.length)];

  return (
    <Avatar
      className={cn("shrink-0 rounded-full", className)}
      aria-label={`${space.name} default profile picture`}
    >
      <AvatarFallback className={cn("rounded-full text-[10px] font-bold", palette)}>
        {initials}
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

function stableSpacePaletteIndex(spaceId: string, paletteCount: number): number {
  let hash = 0;
  for (const character of spaceId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % paletteCount;
}

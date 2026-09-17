import type { Space } from "@/api/spaces/dto/interfaces/types";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import { Avatar, AvatarFallback, cn } from "@/shared/ui";

export function SpaceAvatar({
  space,
  className,
  fallbackClassName,
}: {
  space: Space;
  className?: string;
  fallbackClassName?: string;
}) {
  const initials = spaceInitials(space.name);

  return (
    <Avatar
      className={cn("shrink-0 rounded-[25%]", className)}
      aria-label={`${space.name} default profile picture`}
    >
      <AvatarFallback
        className={cn(
          "rounded-[inherit] text-[10px] font-bold",
          avatarColorClass(space.id),
          avatarInkClass,
          fallbackClassName,
        )}
      >
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

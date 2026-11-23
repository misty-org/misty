const AVATAR_PALETTE = [
  "bg-avatar-red",
  "bg-avatar-orange",
  "bg-avatar-yellow",
  "bg-avatar-green",
  "bg-avatar-blue",
  "bg-avatar-purple",
  "bg-avatar-gray",
] as const;

export const avatarInkClass = "text-avatar-ink";

export function avatarColorClass(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export type AvatarTone = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

export function avatarTone(seed: string): AvatarTone {
  return avatarColorClass(seed).slice("bg-avatar-".length) as AvatarTone;
}

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

// Reserved for AI/agent identity, kept out of the hashed person palette so a
// human never randomly lands on the same color as "the AI".
export const robotAvatarClass = "bg-avatar-aqua";

/** Deterministic pastel background for a person's avatar, keyed by a stable id. */
export function avatarColorClass(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

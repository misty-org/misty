import type { AvatarTone as ItemTone } from "@misty/ui";

const tones: ItemTone[] = ["blue", "green", "orange", "violet", "pink", "amber", "teal"];

export function personTone(userId: string): ItemTone {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}

export const personColor = (userId: string) => `var(--color-tone-${personTone(userId)})`;

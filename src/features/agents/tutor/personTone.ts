import type { AvatarTone as ItemTone } from "@/shared/ui";

const tones: ItemTone[] = ["blue", "green", "orange", "violet", "pink", "amber", "teal"];

/** The tone a person wears in a notebook, the same on every computer. */
export function personTone(userId: string): ItemTone {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}

/** Their tone as a color: their pointer, their caret, the ring on their avatar. */
export const personColor = (userId: string) => `var(--color-tone-${personTone(userId)})`;

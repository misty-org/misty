/** A steady number for a text, so an agent always gets the same colours and the same habits. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const shirts = [
  "#e4572e",
  "#f2a541",
  "#f6d55c",
  "#76b041",
  "#2a9d8f",
  "#3caea3",
  "#4d9de0",
  "#3d5a80",
  "#7768ae",
  "#b56576",
  "#e56b6f",
  "#d98cb3",
];
const trousers = ["#39424e", "#4a4e69", "#5c4b3c", "#2f3e46", "#6b705c"];
const skins = ["#f6d3b3", "#eebd94", "#d9a074", "#b97b52", "#8d5a3b"];
const hairs = ["#2b211c", "#4a3323", "#7a4b27", "#c9963f", "#d8d3c8", "#a34a2a", "#1f2a44"];

export interface CharacterLook {
  shirt: string;
  trousers: string;
  skin: string;
  hair: string;
  /** Which of the haircuts it wears. */
  hairStyle: 0 | 1 | 2 | 3;
}

/** How a figure looks, worked out from its id so it never changes between visits. */
export function characterLook(id: string): CharacterLook {
  const hash = hashOf(id);
  const pick = <T>(list: readonly T[], shift: number): T => list[(hash >>> shift) % list.length]!;
  return {
    shirt: pick(shirts, 0),
    trousers: pick(trousers, 5),
    skin: pick(skins, 9),
    hair: pick(hairs, 13),
    hairStyle: ((hash >>> 17) % 4) as 0 | 1 | 2 | 3,
  };
}

/** Shirt colours for a whole team, so that no two of the first twelve look alike. */
export function teamShirts(ids: string[]): Map<string, string> {
  const taken = new Set<number>();
  const given = new Map<string, string>();
  for (const id of ids) {
    let index = hashOf(id) % shirts.length;
    for (let tries = 0; tries < shirts.length && taken.has(index); tries += 1)
      index = (index + 1) % shirts.length;
    taken.add(index);
    if (taken.size === shirts.length) taken.clear();
    given.set(id, shirts[index]!);
  }
  return given;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Fluxer's emoji data and its rules (https://github.com/fluxerapp/fluxer): src/media/data/
// emojis.json (Unicode 17 emoji-test + CLDR keywords, Discord-style names), the category order and
// labels of features/expressions/utils/UnicodeEmojis.ts, and the search order of
// features/emoji/state/Emoji.ts. The data loads the first time a picker opens.
import { useEffect, useState } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

export interface FluxerEmoji {
  names: string[];
  surrogates: string;
  keywords?: string[];
  skins?: { names: string[]; surrogates: string }[];
}

export type EmojiCategoryKey =
  "people" | "nature" | "food" | "activity" | "travel" | "objects" | "symbols" | "flags";

export const emojiCategoryLabels: Record<EmojiCategoryKey, string> = {
  people: "People",
  nature: "Nature",
  food: "Food & drink",
  activity: "Activities",
  travel: "Travel & places",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
};

export type EmojiData = Record<EmojiCategoryKey, FluxerEmoji[]>;

let data: Promise<EmojiData> | null = null;

export function loadEmojiData(): Promise<EmojiData> {
  data ??= import("./assets/emojis.json")
    .then((module) => (module.default as { categories: EmojiData }).categories)
    .catch((error: unknown) => {
      data = null;
      throw error;
    });
  return data;
}

export function useEmojiData(): EmojiData | null {
  const [loaded, setLoaded] = useState<EmojiData | null>(null);
  useEffect(() => {
    let live = true;
    loadEmojiData()
      .then((found) => live && setLoaded(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}

/** Up to 42 emoji shown under "Frequently used" (getFrecentEmojis(all, 42)). */
const FREQUENT_LIMIT = 42;

/** The emoji this device picked, most recent first. */
export const useFrequentEmoji = createDeviceSetting<string[]>({
  scope: "spaces.chat.recent-emoji",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === "string").slice(0, FREQUENT_LIMIT)
      : [],
});

export function rememberEmoji(emoji: string) {
  useFrequentEmoji
    .getState()
    .set((current) =>
      [emoji, ...current.filter((item) => item !== emoji)].slice(0, FREQUENT_LIMIT),
    );
}

/** 0 is the default yellow; 1 to 5 the Fitzpatrick tones, as Fluxer's one saved skin tone. */
export const useSkinTone = createDeviceSetting<number>({
  scope: "spaces.chat.skin-tone",
  defaults: 0,
  normalize: (stored) =>
    typeof stored === "number" && stored >= 0 && stored <= 5 ? Math.floor(stored) : 0,
});

export const skinToneModifiers = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];
export const skinToneLabels = [
  "Default skin tone",
  "Light skin tone",
  "Medium-light skin tone",
  "Medium skin tone",
  "Medium-dark skin tone",
  "Dark skin tone",
];

/** The emoji in the chosen skin tone, when it has one. */
export function withSkinTone(emoji: FluxerEmoji, tone: number): string {
  return (tone > 0 && emoji.skins?.[tone - 1]?.surrogates) || emoji.surrogates;
}

/** `:thumbsup: :+1: :thumbs_up:`, every name in colons (allNamesString). */
export function allNames(emoji: FluxerEmoji): string {
  return emoji.names.map((name) => `:${name}:`).join(" ");
}

/**
 * Search as Fluxer ranks it: colons stripped and spaces as `_`; an exact name first, then a name
 * that starts with the words, a whole word of a name, a name that has them, then a keyword. Ties
 * go to the emoji used more recently.
 */
export function searchEmoji(all: EmojiData, query: string, frequent: string[]): FluxerEmoji[] {
  const words = query
    .trim()
    .toLowerCase()
    .replace(/^:+|:+$/g, "")
    .replace(/\s+/g, "_");
  if (!words) return [];
  const used = new Map(frequent.map((emoji, index) => [emoji, index]));
  const scored: { emoji: FluxerEmoji; rank: number; order: number }[] = [];
  let order = 0;
  for (const list of Object.values(all))
    for (const emoji of list) {
      order++;
      let rank = 99;
      for (const name of emoji.names) {
        if (name === words) rank = Math.min(rank, 0);
        else if (name.startsWith(words)) rank = Math.min(rank, 1);
        else if (name.split("_").includes(words)) rank = Math.min(rank, 2);
        else if (name.includes(words)) rank = Math.min(rank, 3);
      }
      if (rank === 99 && emoji.keywords?.some((keyword) => keyword.startsWith(words))) rank = 4;
      if (rank < 99) scored.push({ emoji, rank, order });
    }
  return scored
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        (used.get(left.emoji.surrogates) ?? 999) - (used.get(right.emoji.surrogates) ?? 999) ||
        left.order - right.order,
    )
    .map((entry) => entry.emoji);
}

/** Finds the data entry for an emoji character, for its names. */
export function findEmoji(all: EmojiData | null, surrogates: string): FluxerEmoji | undefined {
  if (!all) return undefined;
  for (const list of Object.values(all))
    for (const emoji of list)
      if (
        emoji.surrogates === surrogates ||
        emoji.skins?.some((skin) => skin.surrogates === surrogates)
      )
        return emoji;
  return undefined;
}

import { useEffect, useState } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

export interface ChatEmoji {
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

export type EmojiData = Record<EmojiCategoryKey, ChatEmoji[]>;

let data: Promise<EmojiData> | null = null;

export function loadEmojiData(): Promise<EmojiData> {
  data ??= import("./emojis.json")
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

const FREQUENT_LIMIT = 36;

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
export function withSkinTone(emoji: ChatEmoji, tone: number): string {
  return (tone > 0 && emoji.skins?.[tone - 1]?.surrogates) || emoji.surrogates;
}

/** `:thumbsup: :+1: :thumbs_up:`, every name in colons (allNamesString). */
export function allNames(emoji: ChatEmoji): string {
  return emoji.names.map((name) => `:${name}:`).join(" ");
}

function matchRank(emoji: ChatEmoji, query: string): number | undefined {
  const ranks = emoji.names.map((name) =>
    name === query
      ? 0
      : name.startsWith(query)
        ? 1
        : name.split("_").some((word) => word.startsWith(query))
          ? 2
          : name.includes(query)
            ? 3
            : undefined,
  );
  const best = Math.min(...ranks.filter((rank): rank is number => rank !== undefined));
  if (Number.isFinite(best)) return best;
  return emoji.keywords?.some((keyword) => keyword.startsWith(query.replace(/_/g, " ")))
    ? 4
    : undefined;
}

export function searchEmoji(all: EmojiData, query: string, frequent: string[]): ChatEmoji[] {
  const wanted = query.trim().toLowerCase().replace(/:/g, "").replace(/\s+/g, "_");
  if (!wanted) return [];
  const recency = (emoji: ChatEmoji) => {
    const index = frequent.indexOf(emoji.surrogates);
    return index < 0 ? frequent.length : index;
  };
  return Object.values(all)
    .flat()
    .flatMap((emoji, position) => {
      const rank = matchRank(emoji, wanted);
      return rank === undefined ? [] : [{ emoji, rank, position }];
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        recency(left.emoji) - recency(right.emoji) ||
        left.position - right.position,
    )
    .map((match) => match.emoji);
}

/** Finds the data entry for an emoji character, for its names. */
export function findEmoji(all: EmojiData | null, surrogates: string): ChatEmoji | undefined {
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

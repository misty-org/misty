import { useCallback, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import {
  Bike,
  Clock,
  Flag,
  Gamepad2,
  Heart,
  Leaf,
  Lightbulb,
  Smile,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { EmojiPicker, type EmojiChoice, type EmojiSection } from "@misty/ui";
import {
  emojiCategoryLabels,
  findEmoji,
  rememberEmoji,
  searchEmoji,
  skinToneLabels,
  skinToneModifiers,
  useEmojiData,
  useFrequentEmoji,
  useSkinTone,
  withSkinTone,
  type ChatEmoji,
  type EmojiCategoryKey,
} from "./emoji_data";

const categoryIcons: Record<EmojiCategoryKey, LucideIcon> = {
  people: Smile,
  nature: Leaf,
  food: Utensils,
  activity: Gamepad2,
  travel: Bike,
  objects: Lightbulb,
  symbols: Heart,
  flags: Flag,
};

const nameOf = (emoji: ChatEmoji) => emoji.names[0]?.replace(/_/g, " ") ?? "";

export function ChatEmojiPicker(props: {
  children?: ReactElement;
  anchor?: ReactNode;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  onSelect(emoji: string): void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const all = useEmojiData();
  const frequent = useFrequentEmoji((state) => state.value);
  const tone = useSkinTone((state) => state.value);
  const setTone = useSkinTone((state) => state.set);
  const pinned = useRef(frequent);
  if (props.open === false) pinned.current = frequent;
  const choice = useCallback(
    (emoji: ChatEmoji): EmojiChoice => ({ emoji: withSkinTone(emoji, tone), name: nameOf(emoji) }),
    [tone],
  );
  const sections = useMemo<EmojiSection[]>(() => {
    if (!all) return [];
    const recent = pinned.current
      .map((emoji) => findEmoji(all, emoji))
      .filter((emoji): emoji is ChatEmoji => Boolean(emoji));
    const out: EmojiSection[] = [];
    if (recent.length)
      out.push({ id: "frequent", title: "Used lately", icon: Clock, emojis: recent.map(choice) });
    for (const key of Object.keys(emojiCategoryLabels) as EmojiCategoryKey[])
      out.push({
        id: key,
        title: emojiCategoryLabels[key],
        icon: categoryIcons[key],
        emojis: (all[key] ?? []).map(choice),
      });
    return out;
  }, [all, choice]);
  const search = useCallback(
    (query: string) => (all ? searchEmoji(all, query, frequent).slice(0, 120).map(choice) : []),
    [all, frequent, choice],
  );
  return (
    <EmojiPicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      anchor={props.anchor}
      side={props.side}
      align={props.align}
      sections={sections}
      search={search}
      skinTones={{
        options: skinToneLabels.map((label, index) => ({
          label,
          sample: `👋${skinToneModifiers[index]}`,
        })),
        value: tone,
        onChange: (value) => setTone(value),
      }}
      onPick={(emoji) => {
        rememberEmoji(emoji);
        props.onSelect(emoji);
      }}
    >
      {props.children}
    </EmojiPicker>
  );
}

export function useQuickEmoji(count: number): string[] {
  const frequent = useFrequentEmoji((state) => state.value);
  return useMemo(
    () =>
      [...frequent, "👍", "👌", "🎉", "❤️"]
        .filter((emoji, index, all) => all.indexOf(emoji) === index)
        .slice(0, count),
    [frequent, count],
  );
}

export function isJumbo(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return false;
  const stripped = trimmed.replace(/\s+/g, "");
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍)+$/u.test(stripped)) return false;
  const segments = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(stripped),
  ];
  return segments.length > 0 && segments.length <= 27 && !/^[\d#*]+$/.test(stripped);
}

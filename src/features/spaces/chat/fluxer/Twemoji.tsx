// SPDX-License-Identifier: AGPL-3.0-or-later
// Emoji drawn as Fluxer draws them (https://github.com/fluxerapp/fluxer): Twemoji images, never
// the system font (features/messaging/components/markdown/renderers/EmojiRenderer.tsx,
// features/emoji). Matching and file names come from @twemoji/api (MIT); the artwork is jdecked's
// Twemoji (CC-BY 4.0) from @twemoji/svg, bundled so it works offline.
import twemoji from "@twemoji/api";
import { Fragment, useState, type ReactNode } from "react";

const files = import.meta.glob("/node_modules/@twemoji/svg/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
  exhaustive: true,
}) as Record<string, string>;

/** The Twemoji file for an emoji, as twemoji's grabTheRightIcon names it. */
export function twemojiUrl(emoji: string): string | undefined {
  const raw = emoji.includes("‍") ? emoji : emoji.replace(/️/g, "");
  return files[`/node_modules/@twemoji/svg/${twemoji.convert.toCodePoint(raw)}.svg`];
}

/** One emoji as an image, or the character itself when Twemoji has no picture for it. */
export function Twemoji(props: { emoji: string; className?: string; label?: string }) {
  const [failed, setFailed] = useState(false);
  const url = twemojiUrl(props.emoji);
  if (!url || failed) return <span className={props.className}>{props.emoji}</span>;
  return (
    <img
      src={url}
      alt={props.emoji}
      aria-label={props.label}
      draggable={false}
      className={props.className}
      onError={() => setFailed(true)}
    />
  );
}

/** Splits text into its words and its emoji, each emoji drawn with `className`. */
export function splitEmoji(text: string): { text: string; emoji: boolean }[] {
  const parts: { text: string; emoji: boolean }[] = [];
  let last = 0;
  twemoji.replace(text, (match: string, ...rest: unknown[]) => {
    const offset = rest[rest.length - 2] as number;
    if (offset > last) parts.push({ text: text.slice(last, offset), emoji: false });
    parts.push({ text: match, emoji: true });
    last = offset + match.length;
    return match;
  });
  if (last < text.length) parts.push({ text: text.slice(last), emoji: false });
  return parts;
}

/** Text with its emoji as Twemoji images (`emoji` is Fluxer's global emoji class). */
export function TwemojiText(props: { text: string; jumbo?: boolean }): ReactNode {
  return splitEmoji(props.text).map((part, index) =>
    part.emoji ? (
      <Twemoji
        key={index}
        emoji={part.text}
        className={props.jumbo ? "emoji jumboable" : "emoji"}
      />
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}

/** Jumbo emoji (JumboDetector.ts): a message of nothing but emoji and spaces, at most 30. */
export function isJumbo(text: string): boolean {
  const parts = splitEmoji(text);
  const emoji = parts.filter((part) => part.emoji).length;
  return emoji > 0 && emoji <= 30 && parts.every((part) => part.emoji || !part.text.trim());
}

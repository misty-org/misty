import type { Ref } from "react";

import { cn } from "../classNames";
import { OverflowFadeText, type OverflowFadeTextProps } from "../layout/OverflowFadeText";
import { artTextClass, type ArtColor } from "./artPalette";
import type { Tint } from "./Surface";

/** The type roles a label can take (theme.css). Leave it out to keep the surrounding size. */
export type TextSize = "caption" | "meta" | "control" | "body" | "page" | "title" | "display";
/** Leave it out to keep the surrounding color, as a label inside a button should. */
export type TextTone =
  | "default"
  | "muted"
  | "bright"
  | "danger"
  // What a change or a run is, in the theme's state colors (theme.css --tone-*): lines and files
  // added, removed or changed; an agent working, waiting on the person, failed or done.
  | "added"
  | "removed"
  | "changed"
  | "working"
  | "waiting"
  | "failed"
  | "done"
  // The window chrome's own text and its quieter shade (theme.css --workspace-tab-*), which a
  // theme can set apart from the page's: the sidebar's rows and headings.
  | "chrome"
  | "chrome-muted";
export type TextWeight = "regular" | "medium" | "semibold";

export interface TextProps extends OverflowFadeTextProps {
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  /**
   * A paragraph instead of a label: the text wraps onto as many lines as it needs at the role's
   * own line height, with no fade and no line limit, and a long word breaks rather than spilling
   * past the edge. For descriptions and explanations. `full` and `lines` don't apply.
   * Defaults the element to `p`.
   */
  wrap?: boolean;
  /**
   * The role's size, tone and weight on an element that keeps its own layout: a container whose
   * children take its color (a row of an icon and words, a list), or a run of text inside other
   * text. No fade, no wrapping rules, no display change. Defaults the element to `span`.
   */
  bare?: boolean;
  /**
   * The color of a kind of made thing (Surface's `tint`, theme.css --tint-*) in place of `tone`,
   * for the glyph that says what an item is: a studio tile's icon, a made report's.
   */
  tint?: Tint;
  /**
   * A color from the full-color art palette in place of `tone`, for text drawn on or over art
   * (the Studio's room, a whiteboard in it). It stays the same in either theme.
   */
  art?: ArtColor;
}

const sizeClass: Record<TextSize, string> = {
  caption: "text-caption",
  meta: "text-meta",
  control: "text-control",
  body: "text-body",
  page: "text-page",
  title: "text-title",
  display: "text-display",
};

const toneClass: Record<TextTone, string> = {
  default: "text-cream",
  muted: "text-cream-muted",
  bright: "text-cream-bright",
  danger: "text-danger",
  added: "text-[var(--tone-added)]",
  removed: "text-[var(--tone-failed)]",
  changed: "text-[var(--tone-waiting)]",
  working: "text-[var(--tone-working)]",
  waiting: "text-[var(--tone-waiting)]",
  failed: "text-[var(--tone-failed)]",
  done: "text-[var(--tone-done)]",
  chrome: "text-[var(--workspace-tab-text)]",
  "chrome-muted": "text-[var(--workspace-tab-muted)]",
};

const tintClass: Record<Tint, string> = {
  audio: "text-[var(--tint-audio)]",
  video: "text-[var(--tint-video)]",
  infographic: "text-[var(--tint-infographic)]",
  map: "text-[var(--tint-map)]",
  report: "text-[var(--tint-report)]",
  cards: "text-[var(--tint-cards)]",
  quiz: "text-[var(--tint-quiz)]",
  slides: "text-[var(--tint-slides)]",
  table: "text-[var(--tint-table)]",
  lesson: "text-[var(--tint-lesson)]",
};

const weightClass: Record<TextWeight, string> = {
  regular: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
};

/**
 * Text in one of the type roles. As a label (the default) it is one line that fades at its end
 * when it doesn't fit (two with `lines={2}`), never wraps into a ragged row and never ends in an
 * ellipsis; `full` shows the whole text in a tooltip while it is cut. With `wrap` it is a
 * paragraph that wraps instead. `className` is for layout only: features pick a role, not a size
 * or a color.
 *
 * ```tsx
 * <Text size="meta" tone="muted">{formatTime(chat.updatedAt)}</Text>
 * <Text size="body" tone="muted" wrap>{engine.description}</Text>
 * <Text size="display" weight="semibold">{count}</Text>
 * ```
 */
export function Text({
  size,
  tone,
  weight,
  wrap = false,
  bare = false,
  tint,
  art,
  className,
  ...props
}: TextProps) {
  const classes = cn(
    size && sizeClass[size],
    art ? artTextClass[art] : tint ? tintClass[tint] : tone && toneClass[tone],
    weight && weightClass[weight],
    className,
  );
  if (bare) {
    const { as: Tag = "span", full: _full, lines: _lines, ref, ...rest } = props;
    return <Tag {...rest} ref={ref as Ref<never>} data-slot="text" className={classes} />;
  }
  if (wrap) {
    const { as: Tag = "p", full: _full, lines: _lines, ref, ...rest } = props;
    return (
      <Tag
        {...rest}
        ref={ref as Ref<never>}
        data-slot="text"
        data-wrap="true"
        className={cn("block min-w-0 whitespace-normal [overflow-wrap:anywhere]", classes)}
      />
    );
  }
  return <OverflowFadeText {...props} className={classes} />;
}

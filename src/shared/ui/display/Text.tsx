import type { Ref } from "react";

import { cn } from "../classNames";
import { OverflowFadeText, type OverflowFadeTextProps } from "../layout/OverflowFadeText";

/** The type roles a label can take (theme.css). Leave it out to keep the surrounding size. */
export type TextSize = "caption" | "meta" | "control" | "body" | "page" | "title" | "display";
/** Leave it out to keep the surrounding color, as a label inside a button should. */
export type TextTone = "default" | "muted" | "bright" | "danger";
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
export function Text({ size, tone, weight, wrap = false, className, ...props }: TextProps) {
  const classes = cn(
    size && sizeClass[size],
    tone && toneClass[tone],
    weight && weightClass[weight],
    className,
  );
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

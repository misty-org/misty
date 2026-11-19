import type { CSSProperties, ReactNode } from "react";

import { cn } from "../classNames";

/**
 * The swatches a role's color picker offers first: the app's pastels, the same ones a person's
 * avatar wears. A role may also take any other color.
 */
export const roleColorPresets = [
  "#eab7ab",
  "#f0c38e",
  "#f0d58c",
  "#c5cf8e",
  "#a0c4d4",
  "#d3b3c9",
  "#d5c9b8",
] as const;

/** A role color as the server stores it: "#rrggbb", or empty for none. */
export function isRoleColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * The style that carries a role's color to the parts below. Any color a Space picks is mixed a
 * little toward the theme's text, the way the item tones are, so a dark red stays readable on
 * the dark theme and a pale yellow on the light one.
 */
export function roleColorStyle(color: string | undefined): CSSProperties | undefined {
  return color && isRoleColor(color) ? ({ "--role-color": color } as CSSProperties) : undefined;
}

const coloredText = "text-[color-mix(in_srgb,var(--role-color)_78%,var(--misty-theme-text))]";

/**
 * A person's name in their highest colored role's color, as in a message's header, a reply's
 * preview or the member list. With no color it is the default text.
 */
export function RoleName(props: {
  color?: string;
  children: ReactNode;
  /** `semibold` in a message's header, `medium` in lists. */
  weight?: "medium" | "semibold";
  className?: string;
}) {
  const style = roleColorStyle(props.color);
  return (
    <span
      style={style}
      className={cn(
        props.weight === "semibold" ? "font-semibold" : "font-medium",
        style ? coloredText : "text-cream-bright",
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

/** A role's color as a small round mark, before its name in a list or a picker. */
export function RoleDot(props: { color?: string }) {
  const style = roleColorStyle(props.color);
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "inline-block size-3 shrink-0 rounded-full",
        style ? "bg-[var(--role-color)]" : "bg-cream-muted",
      )}
    />
  );
}

/**
 * A role mentioned in a message, as Discord draws it: "@Moderator" in the role's color over a
 * faint wash of it. A role with no color, or one since deleted, reads like any other mention.
 */
export function RoleMention(props: { color?: string; label: string }) {
  const style = roleColorStyle(props.color);
  return (
    <span
      style={style}
      className={cn(
        "inline-flex items-center rounded-sm px-1 py-0.5 font-medium",
        style
          ? cn(coloredText, "bg-[color-mix(in_srgb,var(--role-color)_16%,transparent)]")
          : "bg-mention-bg/35 text-cream-bright",
      )}
    >
      @{props.label}
    </span>
  );
}

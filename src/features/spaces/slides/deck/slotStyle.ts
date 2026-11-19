import type { CSSProperties } from "react";
import type { SlotBox, TextSlotSpec } from "./layouts";
import { fontStack, screenColor, type DeckTheme } from "./themes";
import type { SlotInk } from "./richText";

/**
 * The styles a text slot is drawn with, as plain style objects (string values with units), so
 * React, the editor and the offscreen measurer all lay a slot out the same way. These are the
 * slide's own type and colors (its theme), never Misty's interface.
 */

type Style = Record<string, string>;

export function boxStyle(box: SlotBox): Style {
  return {
    position: "absolute",
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
  };
}

/** The slot's frame: its box, its vertical alignment, and nothing spilling out of it. */
export function textBoxStyle(spec: TextSlotSpec): Style {
  return {
    ...boxStyle(spec.box),
    display: "flex",
    flexDirection: "column",
    justifyContent:
      spec.valign === "end" ? "flex-end" : spec.valign === "center" ? "center" : "flex-start",
    overflow: "hidden",
  };
}

/** The text inside the frame at one font size, in frame pixels. */
export function textContentStyle(theme: DeckTheme, spec: TextSlotSpec, size: number): Style {
  const font = spec.font === "heading" ? theme.heading : theme.body;
  const color = screenColor(theme, spec.color);
  return {
    flex: "none",
    display: "flex",
    flexDirection: "column",
    gap: `${theme.spacing.paragraph}em`,
    fontFamily: fontStack(font),
    fontWeight: String(
      spec.font === "heading" ? Math.max(spec.weight, theme.headingWeight) : spec.weight,
    ),
    fontSize: `${size}px`,
    lineHeight: String(spec.lineHeight),
    letterSpacing: spec.tracking ? `${spec.tracking}em` : spec.font === "heading" ? "-0.01em" : "0",
    color,
    textAlign: spec.align === "center" ? "center" : "left",
    overflowWrap: "break-word",
    wordBreak: "normal",
    whiteSpace: "pre-wrap",
    outline: "none",
  };
}

/** Applies a style object to an element, custom properties included. */
export function applyStyle(element: HTMLElement, style: Style): void {
  for (const [key, value] of Object.entries(style)) {
    if (key.startsWith("--")) element.style.setProperty(key, value);
    else
      element.style.setProperty(
        key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        value,
      );
  }
}

/** The same object as React's style prop takes it. */
export function reactStyle(style: Style): CSSProperties {
  return style as CSSProperties;
}

/** The colors and bullet spacing a slot's paragraphs and bullets are drawn with. */
export function slotInk(theme: DeckTheme, spec: TextSlotSpec): SlotInk {
  return {
    color: screenColor(theme, spec.color),
    marker: screenColor(theme, "accent"),
    bulletGap: `${theme.spacing.bullet}em`,
  };
}

import type { ElementType, HTMLAttributes, Ref } from "react";

import { cn } from "../classNames";
import type { PressableWash } from "../controls/Pressable";
import "../controls/pressable.css";
import { artFillClass, artRingClass, artTintClass, type ArtColor } from "./artPalette";

/**
 * What a surface is, which decides its fill:
 * - `card`: a raised card, tile or panel on the page.
 * - `page`: the page's own fill, for something set into a card (an inset preview, a well).
 * - `well`: a faint wash marking a group or a selection without a card's edge.
 * - `faint`: the lightest wash of the text color, the same step over any fill under it: a note
 *   or a frame set into a panel or a dialog, or the look of a row under the pointer.
 * - `added`, `removed`: the faint washes of the Git colors behind a line added or removed, as a
 *   diff's lines take them (CodeDiff draws the same).
 * - `active`: the fill of a selected or pressed surface.
 * - `workspace`: the window's own fill, around and behind the panes.
 * - `sidebar`: the sidebar's fill, for a panel that sits beside a page like it.
 * - `inverse`: the text color as a fill with the page's color on it, for the one marker that
 *   must stand out from everything near it (today in a calendar).
 * - `drop`: where something being dragged will land.
 * - `chrome`: the window frame's own fill (it follows the theme's chrome color when set).
 * - `tab-well`: the well the window's tab row and Space bar sit in.
 * - `media`: a full-color stand-in for a picture or the Studio's office, for previews and demos.
 * - `board`: the white board a drawing sits on, white in every theme so the drawing keeps its
 *   own colors.
 * - `glass`: frosted glass floating over the desktop from a window of its own, light or dark
 *   with the system rather than the theme, with its own faint edge, shadow and ink.
 * - `smoke`: a near-black panel floating over another app or the desktop, the same in every
 *   theme, with its own faint edge and white text.
 * - `scene-panel`: a panel floating over a full-color scene inside a page (the Studio's office):
 *   the same solid card as the chat's side cards, with their faint edge and soft shadow.
 * - `stage`: the window's own fill lit faintly at its middle, behind a scene drawn in the window.
 * - `track`: the hairline's color as a fill, for the empty part of a meter (a bar's track, its
 *   free share in a legend).
 * - `none`: no fill, for an edge or a line alone.
 */
export type SurfaceTone =
  | "card"
  | "page"
  | "well"
  | "faint"
  | "added"
  | "removed"
  | "active"
  | "workspace"
  | "sidebar"
  | "inverse"
  | "drop"
  | "chrome"
  | "tab-well"
  | "media"
  | "board"
  | "glass"
  | "smoke"
  | "scene-panel"
  | "stage"
  | "track"
  | "none";
/**
 * Its edge: none, the default hairline, the stronger one for something that must stand out,
 * `bright` for the target or selection being pointed at, `dashed` for an empty slot that
 * something can be put into, or `field` for a box around a text field (a search or ask box),
 * a hairline that turns strong while the field in it has focus. `right` and `wrong` are an edge
 * in the done and failed tones, for an answer that has been marked (a quiz's choices).
 */
export type SurfaceEdge =
  "none" | "hairline" | "strong" | "bright" | "dashed" | "field" | "right" | "wrong";
/**
 * Its corners, from the theme's radius scale; `sm` (4) for a mark or chip inside a row (a small
 * badge, a thumbnail); `2xl` (16) only for a panel floating over the desktop (`glass`, `smoke`)
 * or over a scene (`scene-panel`), which sits apart from the app's own panels; `full` for a round
 * picture or dot.
 */
export type SurfaceRadius = "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";

const toneClass: Record<SurfaceTone, string> = {
  card: "bg-charcoal-card",
  page: "bg-charcoal-bg",
  well: "bg-charcoal-hover",
  faint: "bg-row-hover",
  added: "bg-[color:color-mix(in_srgb,var(--tone-added)_14%,transparent)]",
  removed: "bg-[color:color-mix(in_srgb,var(--tone-failed)_13%,transparent)]",
  active: "bg-charcoal-active",
  workspace: "bg-charcoal-workspace",
  sidebar: "bg-charcoal-sidebar",
  inverse: "bg-cream text-charcoal-bg",
  drop: "bg-cream-muted/15",
  chrome: "bg-[var(--misty-window-chrome,var(--misty-theme-workspace))]",
  "tab-well": "bg-[var(--workspace-tab-surface)]",
  media: "bg-[linear-gradient(135deg,var(--tone-working),var(--tone-done))]",
  board: "bg-art-white",
  glass: [
    "border border-white/50 bg-[rgb(250_250_250/0.78)] text-art-ink",
    "shadow-[inset_0_1px_0_rgb(255_255_255/0.56),0_6px_20px_rgb(0_0_0/0.12)]",
    "backdrop-blur-[18px] backdrop-saturate-[1.2]",
    "dark:border-white/12 dark:bg-[rgb(32_32_34/0.78)] dark:text-art-paper",
    "dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_6px_20px_rgb(0_0_0/0.3)]",
  ].join(" "),
  smoke: "border border-white/12 bg-[rgb(20_20_20/0.96)] text-art-white",
  // The same card as the chat's side cards (sidePanel.css): the sidebar's fill, a faint edge drawn
  // as an outline and a soft shadow. Solid, never frosted, so the scene behind it doesn't bleed in.
  "scene-panel": [
    "bg-charcoal-sidebar text-cream",
    "outline-[0.5px] outline-solid -outline-offset-[0.5px]",
    "outline-[color-mix(in_srgb,var(--misty-theme-text)_9%,transparent)]",
    "shadow-[0_2px_4px_rgb(0_0_0/0.22),0_1px_2px_rgb(0_0_0/0.22)]",
  ].join(" "),
  stage: ["bg-[image:var(--surface-stage)]"].join(" "),
  track: "bg-charcoal-border",
  none: "",
};

const edgeClass: Record<SurfaceEdge, string> = {
  none: "",
  hairline: "border border-charcoal-border",
  strong: "border border-charcoal-border-strong",
  bright: "border border-cream",
  dashed: "border border-dashed border-cream/40",
  field: "border border-charcoal-border focus-within:border-charcoal-border-strong",
  right: "border border-[color-mix(in_srgb,var(--tone-done)_55%,transparent)]",
  wrong: "border border-[color-mix(in_srgb,var(--tone-failed)_55%,transparent)]",
};

const radiusClass: Record<SurfaceRadius, string> = {
  none: "",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
};

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  /** The element to render; a `div` unless it is a list item, a section or the like. */
  as?: ElementType;
  tone?: SurfaceTone;
  edge?: SurfaceEdge;
  radius?: SurfaceRadius;
  /**
   * The shared hover look (Pressable's washes) for a surface that reacts to the pointer but isn't
   * a button itself, such as a row that holds a checkbox and a drag handle. A surface that is
   * clicked as a whole is a Pressable instead.
   */
  wash?: PressableWash;
  /**
   * Shows the wash as if hovered, for a hover the page can't see (a native window control the
   * system owns while the pointer is over it).
   */
  hovered?: boolean;
  /** Briefly marks the surface the person was just taken to (a setting found by search). */
  flash?: boolean;
  /**
   * Casts a soft shadow under it, for a small card floating over the content of its own pane (a
   * find card over a document) rather than sitting in the page.
   */
  raised?: boolean;
  /**
   * Casts a deep shadow all round, for a panel that slides out over the page from the window's
   * edge (the sidebar revealed while it is collapsed).
   */
  floating?: boolean;
  /**
   * The state of the work a card stands for, in the theme's state tones: `working` takes a light
   * wash of the working tone in place of its fill, `waiting` (on the person) an amber edge. Leave
   * it out for work at rest. `waiting` needs an edge to color.
   */
  state?: SurfaceState;
  /**
   * The kind of made thing the surface stands for (an audio overview, a mind map, a report…), in
   * that kind's color (theme.css --tint-*): its fill and edge mix a little of the color over the
   * page, in place of `tone` and `edge`. `faint` for a tile or a node, `strong` for the one at
   * the center (a mind map's root). With `wash="tint"` the fill deepens under the pointer.
   */
  tint?: Tint;
  /** How much of the tint the fill takes: `faint` (the default) or `strong`. */
  tintLevel?: "faint" | "strong";
  /**
   * A solid fill from the full-color art palette in place of `tone`, for a dot or a mark drawn
   * over art (the Studio's room).
   */
  art?: ArtColor;
  /** A 2px ring in an art color around the surface, for a state marked round a picture. */
  artRing?: ArtColor;
  /**
   * A faint wash of an art color with an edge of it, in place of `tone` and `edge`, for something
   * in full color that asks for a look (a question in the Studio).
   */
  artWash?: ArtColor;
  ref?: Ref<HTMLElement>;
}

/** What a card's work is doing, for `Surface`'s `state`. */
export type SurfaceState = "working" | "waiting";

/** The kinds of made things that carry a color of their own (theme.css --tint-*). */
export type Tint =
  | "audio"
  | "video"
  | "infographic"
  | "map"
  | "report"
  | "cards"
  | "quiz"
  | "slides"
  | "table"
  | "lesson";

// Literal class names so Tailwind picks them up. `--surface-tint` is read by the fills below and
// by Pressable's `tint` wash.
const tintVarClass: Record<Tint, string> = {
  audio: "[--surface-tint:var(--tint-audio)]",
  video: "[--surface-tint:var(--tint-video)]",
  infographic: "[--surface-tint:var(--tint-infographic)]",
  map: "[--surface-tint:var(--tint-map)]",
  report: "[--surface-tint:var(--tint-report)]",
  cards: "[--surface-tint:var(--tint-cards)]",
  quiz: "[--surface-tint:var(--tint-quiz)]",
  slides: "[--surface-tint:var(--tint-slides)]",
  table: "[--surface-tint:var(--tint-table)]",
  lesson: "[--surface-tint:var(--tint-lesson)]",
};

const tintLevelClass = {
  faint: cn(
    "border border-[color:color-mix(in_srgb,var(--surface-tint)_20%,transparent)]",
    "bg-[color:color-mix(in_srgb,var(--surface-tint)_9%,var(--color-charcoal-bg))]",
  ),
  strong: cn(
    "border border-[color:color-mix(in_srgb,var(--surface-tint)_26%,transparent)]",
    "bg-[color:color-mix(in_srgb,var(--surface-tint)_26%,var(--color-charcoal-bg))]",
  ),
};

const stateFill = "bg-[color:color-mix(in_srgb,var(--tone-working)_6%,transparent)]";
const stateEdge =
  "border-[color:color-mix(in_srgb,var(--tone-waiting)_45%,var(--color-charcoal-border))]";

/** `raised`: a shadow that falls below the card and fades well before its sides. */
const raisedClass = "shadow-[0_12px_32px_-16px_rgb(0_0_0/0.7)]";
/** `floating`: a shadow that spreads past every side, over the page under the panel. */
const floatingClass = "shadow-[0_8px_32px_rgb(0_0_0/0.45)]";

/**
 * A box with one of the theme's fills and edges: the one way a feature gives something a
 * background or a border. Features pick what the surface is, never a color. `className` is for
 * layout (padding, gap, grid, size), and the text inside keeps its color unless a `Text` sets it.
 *
 * ```tsx
 * <Surface tone="card" edge="hairline" radius="xl" className="grid gap-3 p-4">…</Surface>
 * <Surface as="li" tone="page" radius="lg" className="p-2">…</Surface>
 * ```
 */
export function Surface({
  as: Tag = "div",
  tone = "card",
  edge = "none",
  radius = "none",
  wash,
  hovered,
  flash,
  raised,
  floating,
  state,
  tint,
  tintLevel = "faint",
  art,
  artRing,
  artWash,
  className,
  ...props
}: SurfaceProps) {
  return (
    <Tag
      data-slot="surface"
      data-wash={wash}
      data-hover={hovered || undefined}
      data-flash={flash || undefined}
      data-state={state}
      className={cn(
        tint
          ? cn(tintVarClass[tint], tintLevelClass[tintLevel])
          : artWash
            ? artTintClass[artWash]
            : cn(
                art ? artFillClass[art] : state === "working" ? stateFill : toneClass[tone],
                edgeClass[edge],
              ),
        state === "waiting" && edge !== "none" && stateEdge,
        artRing && artRingClass[artRing],
        raised && raisedClass,
        floating && floatingClass,
        radiusClass[radius],
        "data-[flash=true]:bg-charcoal-hover",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The looks of marks Misty draws over whatever is on screen, from a transparent window of its
 * own that floats over another app or the desktop: a bubble of words beside the pointer, a
 * meter and a spinner, the spot it points at, a drawing it makes, the pointer it acts with. The
 * theme doesn't reach what is under them, so their colors are fixed: near-white with a dark halo
 * reads on any background. They are class strings because those windows build some marks as
 * they go (`box.className = screenMarkClass.spotlight`); in JSX they go in `className` beside
 * the mark's own layout.
 */
export const screenMarkClass = {
  /** Near-white with dark ink and a dark halo: a bubble of words beside the pointer, a meter's bars. */
  fill: "bg-art-paper text-art-ink shadow-[0_1px_0.375rem_rgb(0_0_0/0.55)]",
  /** A listening meter's bars: near-white, or the companion's color, with a dark halo. */
  meter: "bg-[var(--companion-ink,var(--color-art-paper))] shadow-[0_1px_0.375rem_rgb(0_0_0/0.55)]",
  /** A sweep from clear to near-white, for a spinner's arc. */
  sweep: "bg-[conic-gradient(from_90deg,transparent,var(--color-art-paper))]",
  /** A dark halo around a drawn shape (an SVG). */
  halo: "drop-shadow-[0_0_0.375rem_rgb(0_0_0/0.55)]",
  /**
   * The exact spot a pointer names: a near-white outline with a dark halo inside and out, at a
   * control's own corners. With `data-shape="ring"` it is a ring around a spot instead, its halo
   * breathing.
   */
  target:
    "rounded-md border-2 border-[var(--companion-ink,var(--color-art-paper))] " +
    "shadow-[0_0_0.5rem_rgb(0_0_0/0.55),inset_0_0_0.375rem_rgb(0_0_0/0.55)] data-[shape=ring]:rounded-full " +
    "data-[shape=ring]:animate-[misty-halo-pulse_1.2s_ease-in-out_infinite] motion-reduce:animate-none",
  /**
   * Where to look: a white outline, with a faint dim over everything around it. Only the first
   * of several regions dims, so two of them don't darken the screen twice.
   */
  spotlight:
    "rounded-lg border-2 border-white/92 outline outline-black/45 " +
    "shadow-[0_0_0_100vmax_rgb(0_0_0/0.14)] not-first:shadow-none",
  /** A drawing's white board over the screen: a card with a faint edge and a soft shadow, its words in gray. */
  board:
    "rounded-xl border border-black/12 bg-art-white text-art-muted " +
    "shadow-[0_0.75rem_2rem_rgb(0_0_0/0.28)]",
  /** Strokes drawn straight onto the screen: white, with a dark shadow so they read on any page. */
  strokes: "[filter:drop-shadow(0_0_1.5px_rgb(0_0_0/0.9))_drop-shadow(0_1px_0.1875rem_rgb(0_0_0/0.5))]",
  /** A pointer's arrow (an SVG path): white with a dark edge. */
  pointer: "fill-art-white stroke-art-ink stroke-2 [stroke-linejoin:round]",
  /** A click's ripple (an SVG circle), spreading out from the pointer's tip once. */
  ripple:
    "fill-none stroke-white/80 stroke-2 animate-[misty-ripple_0.6s_ease-out_forwards] " +
    "motion-reduce:animate-none motion-reduce:opacity-0",
  /** The glow around the edges of a screen Misty is working on. */
  edgeGlow:
    "shadow-[inset_0_0_0_0.125rem_rgb(255_255_255/0.55),inset_0_0_3rem_0.5rem_rgb(255_255_255/0.18)]",
  /** The same glow, quieter, while Misty waits on the person. */
  edgeGlowQuiet:
    "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35),inset_0_0_1.5rem_0.125rem_rgb(255_255_255/0.08)]",
  /**
   * The line at the bottom of the screen: what Misty is saying, or what the tour asks for next
   * (`data-tip`, a little brighter). Hidden while empty.
   */
  caption:
    "pointer-events-none absolute bottom-[8%] left-1/2 w-max max-w-[min(48rem,80%)] -translate-x-1/2 " +
    "rounded-xl bg-art-ink/85 px-4 py-2 text-center text-body text-art-paper " +
    "transition-opacity duration-200 data-[tip]:bg-art-ink data-[tip]:font-medium " +
    "data-[hidden]:opacity-0 motion-reduce:transition-none",
  /**
   * The paint the pointer leaves while the person holds the talk keys, to circle or scribble over
   * what they mean: a soft red marker line with a dark edge, fading once they let go
   * (`data-fading`).
   */
  trail:
    "pointer-events-none absolute top-0 left-0 overflow-visible fill-none " +
    "stroke-[var(--companion-ink,#ff6b6b)] [stroke-opacity:0.85] " +
    "[stroke-width:5] [stroke-linecap:round] [stroke-linejoin:round] " +
    "[filter:drop-shadow(0_0_1.5px_rgb(0_0_0/0.6))] transition-opacity duration-700 " +
    "data-[fading]:opacity-0 motion-reduce:transition-none",
  /**
   * A 3D model's part name, pinned beside the part: a small dark pill on the white board, the part
   * being talked about now (`data-current`) fully dark and the rest a little lighter.
   */
  modelLabel:
    "pointer-events-none absolute top-0 left-0 rounded-md bg-art-ink/70 px-1.5 py-0.5 " +
    "text-caption font-medium whitespace-nowrap text-art-paper data-[current]:bg-art-ink",
  /** Keyboard focus on something drawn over the desktop: a gray ring that reads on any background. */
  focusRing:
    "outline-none focus-visible:rounded-2xl focus-visible:shadow-[0_0_0_0.125rem_rgb(160_160_160/0.7)]",
} as const;

/**
 * Ink for the drawings Tutor makes (Excalidraw strokes take colors, not classes): near-black on
 * the white board and white over the screen, plus a few colors that tell a drawing's parts apart,
 * brighter over the screen so they read on any page.
 */
export const sketchInk = {
  board: {
    ink: "#1e1e1e",
    red: "#e03131",
    blue: "#1971c2",
    green: "#2f9e44",
    orange: "#f08c00",
    violet: "#6741d9",
  },
  screen: {
    ink: "#ffffff",
    red: "#ff6b6b",
    blue: "#4dabf7",
    green: "#69db7c",
    orange: "#ffa94d",
    violet: "#b197fc",
  },
} as const;
export type SketchInk = (typeof sketchInk)[keyof typeof sketchInk];

/**
 * The colors the companion can wear (Settings › Tutor): its listening meter, the ring around a
 * pointed control and the trail it leaves. White is the default; the others are bright enough to
 * read over any page.
 */
export const companionTints = {
  white: "#f2f2f2",
  red: "#ff6b6b",
  blue: "#4dabf7",
  green: "#69db7c",
  orange: "#ffa94d",
  violet: "#b197fc",
} as const;
export type CompanionTint = keyof typeof companionTints;

/** A 3D model's own tones: a part with no color, the outline every part has, and the glow on the part being talked about. */
export const modelInk = { part: "#ced4da", edge: "#343a40", glow: "#ffd43b" } as const;
export type SketchColor = Exclude<keyof SketchInk, "ink">;

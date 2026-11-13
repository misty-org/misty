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
  fill: "bg-art-paper text-art-ink shadow-[0_1px_6px_rgb(0_0_0/0.55)]",
  /** A sweep from clear to near-white, for a spinner's arc. */
  sweep: "bg-[conic-gradient(from_90deg,transparent,var(--color-art-paper))]",
  /** A dark halo around a drawn shape (an SVG). */
  halo: "drop-shadow-[0_0_6px_rgb(0_0_0/0.55)]",
  /**
   * The exact spot a pointer names: a near-white outline with a dark halo inside and out, at a
   * control's own corners. With `data-shape="ring"` it is a ring around a spot instead, its halo
   * breathing.
   */
  target:
    "rounded-md border-2 border-art-paper " +
    "shadow-[0_0_8px_rgb(0_0_0/0.55),inset_0_0_6px_rgb(0_0_0/0.55)] data-[shape=ring]:rounded-full " +
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
    "shadow-[0_12px_32px_rgb(0_0_0/0.28)]",
  /** Strokes drawn straight onto the screen: white, with a dark shadow so they read on any page. */
  strokes: "[filter:drop-shadow(0_0_1.5px_rgb(0_0_0/0.9))_drop-shadow(0_1px_3px_rgb(0_0_0/0.5))]",
  /** A pointer's arrow (an SVG path): white with a dark edge. */
  pointer: "fill-art-white stroke-art-ink stroke-2 [stroke-linejoin:round]",
  /** A click's ripple (an SVG circle), spreading out from the pointer's tip once. */
  ripple:
    "fill-none stroke-white/80 stroke-2 animate-[misty-ripple_0.6s_ease-out_forwards] " +
    "motion-reduce:animate-none motion-reduce:opacity-0",
  /** The glow around the edges of a screen Misty is working on. */
  edgeGlow:
    "shadow-[inset_0_0_0_2px_rgb(255_255_255/0.55),inset_0_0_48px_8px_rgb(255_255_255/0.18)]",
  /** The same glow, quieter, while Misty waits on the person. */
  edgeGlowQuiet:
    "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35),inset_0_0_24px_2px_rgb(255_255_255/0.08)]",
  /** Keyboard focus on something drawn over the desktop: a gray ring that reads on any background. */
  focusRing:
    "outline-none focus-visible:rounded-2xl focus-visible:shadow-[0_0_0_2px_rgb(160_160_160/0.7)]",
} as const;

// The layout of a notebook's three flat panes (sources, the conversation, the studio), shared by
// the components that draw them. Their fill and hairlines come from Surface.

/** One pane: a column that clips, so only its scrolling part moves. */
export const paneClass = "flex min-h-0 min-w-0 flex-col overflow-hidden";
/** A side pane folded to a rail of icons. */
export const railClass = `${paneClass} items-center gap-1 overflow-y-auto py-2`;
/** A pane's header: its name, then its controls. */
export const paneHeadClass = "flex min-h-12 items-center gap-1.5 pt-2 pr-2 pb-1 pl-2.5";
/** The part of a side pane under its header that scrolls. */
export const paneScrollClass = "min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-3.5";
/**
 * The middle pane's scrolling column, everything in it kept to one readable width. The width is
 * marked important because it is the column's to decide, over a child's own (a guide's).
 */
export const middleScrollClass =
  "flex min-h-0 flex-1 flex-col gap-5.5 overflow-y-auto px-[clamp(20px,6%,72px)] pt-8 pb-6 " +
  "*:mx-auto *:w-full *:max-w-180!";

/**
 * The one shape of a list row in Misty, shared by NavRow, ListRow, TreeRow and menu rows: 32px
 * tall, 7px corners (`rounded-md`), 8px in from each side and 8px between its parts. A feature
 * never sizes, rounds or pads a row of its own; it takes this, so no two lists differ.
 */
export const rowShape = "flex h-8 min-w-0 items-center gap-2 rounded-md px-2";

/** The same row when its text may wrap to a second line: at least 32px, with 4px above and below. */
export const rowShapeWrap = "flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1";

/** A row with a second, muted line under its label (ListRow's `description`): at least 48px. */
export const rowShapeTwoLine = "flex min-h-12 min-w-0 items-center gap-2 rounded-md px-2 py-1.5";
